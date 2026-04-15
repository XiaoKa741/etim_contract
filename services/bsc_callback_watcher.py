#!/usr/bin/env python3
"""
ETIM Token CallbackFailed 事件监听服务 (高可靠版)

特性：
- WebSocket 实时订阅 + HTTP 断线补漏
- 持久化已处理记录，重启不丢状态
- 异步并发处理，高吞吐量
- 心跳检测 + 自动重连
- 优雅停机，信号处理
"""
import os
import sys
import json
import time
import logging
import argparse
import signal
import asyncio
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Set, Dict, Any
from collections import OrderedDict

from dotenv import load_dotenv

# 加载 .env
load_dotenv()

# ============== 配置 ==============
# BSC RPC
RPC_URL = os.getenv("BSC_RPC_URL", "https://bsc-dataseed1.binance.org")
RPC_FALLBACKS = os.getenv("BSC_RPC_FALLBACKS", "").split(",") if os.getenv("BSC_RPC_FALLBACKS") else []

# BSC WebSocket
WS_URL = os.getenv("BSC_WS_URL", "wss://bsc-ws-node.nariox.org")
WS_FALLBACKS = os.getenv("BSC_WS_FALLBACKS", "").split(",") if os.getenv("BSC_WS_FALLBACKS") else []

# 私钥
PRIVATE_KEY = os.getenv("CALLBACK_WATCHER_PRIVATE_KEY", "")

# 合约地址
ETIM_TOKEN_ADDRESS = os.getenv("ETIM_TOKEN_ADDRESS", "")
ETIM_MAIN_ADDRESS = os.getenv("ETIM_MAIN_ADDRESS", "")

# 飞书
LARK_WEBHOOK = os.getenv("LARK_WEBHOOK", "")

# 可靠性参数
WS_RECONNECT_DELAY = int(os.getenv("WS_RECONNECT_DELAY", "5"))
WS_PING_INTERVAL = int(os.getenv("WS_PING_INTERVAL", "15"))
WS_PING_TIMEOUT = int(os.getenv("WS_PING_TIMEOUT", "30"))
HTTP_BACKSCAN_BLOCKS = int(os.getenv("HTTP_BACKSCAN_BLOCKS", "50"))  # 断线后回扫区块数

# Gas
MAX_GAS_PRICE_GWEI = int(os.getenv("MAX_GAS_PRICE_GWEI", "5"))
GAS_LIMIT = int(os.getenv("GAS_LIMIT", "300000"))

# 持久化
STATE_DIR = Path(os.getenv("STATE_DIR", "./state"))
PROCESSED_CACHE_SIZE = int(os.getenv("PROCESSED_CACHE_SIZE", "10000"))

# 并发
MAX_CONCURRENT_CALLBACKS = int(os.getenv("MAX_CONCURRENT_CALLBACKS", "5"))

# ============== 日志 ==============
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger(__name__)

# ============== ABI ==============
ETIM_TOKEN_ABI = [
    {
        "anonymous": False,
        "inputs": [
            {"indexed": False, "name": "callbackName", "type": "string"},
            {"indexed": True, "name": "from", "type": "address"},
            {"indexed": True, "name": "to", "type": "address"},
            {"indexed": False, "name": "value", "type": "uint256"},
            {"indexed": False, "name": "reason", "type": "bytes"}
        ],
        "name": "CallbackFailed",
        "type": "event"
    }
]

ETIM_MAIN_ABI = [
    {
        "inputs": [
            {"name": "from", "type": "address"},
            {"name": "to", "type": "address"},
            {"name": "value", "type": "uint256"}
        ],
        "name": "onTokenTransfer",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {"name": "from", "type": "address"},
            {"name": "to", "type": "address"},
            {"name": "value", "type": "uint256"}
        ],
        "name": "onTokenBalanceChanged",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{"name": "addr", "type": "address"}],
        "name": "tokenCallbackWhitelist",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function"
    }
]


class ProcessedCache:
    """持久化的已处理记录缓存（LRU）"""

    def __init__(self, cache_file: Path, max_size: int = 10000):
        self.cache_file = cache_file
        self.max_size = max_size
        self.cache: OrderedDict = OrderedDict()
        self._load()

    def _load(self):
        """从文件加载"""
        if self.cache_file.exists():
            try:
                with open(self.cache_file, 'r') as f:
                    data = json.load(f)
                    for key in data.get('processed', []):
                        self.cache[key] = True
                logger.info(f"✅ 加载已处理记录: {len(self.cache)} 条")
            except Exception as e:
                logger.warning(f"⚠️ 加载缓存失败: {e}")

    def _save(self):
        """保存到文件"""
        try:
            self.cache_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self.cache_file, 'w') as f:
                json.dump({'processed': list(self.cache.keys())}, f)
        except Exception as e:
            logger.warning(f"⚠️ 保存缓存失败: {e}")

    def contains(self, key: str) -> bool:
        """检查是否已处理"""
        if key in self.cache:
            self.cache.move_to_end(key)
            return True
        return False

    def add(self, key: str):
        """添加记录"""
        if key in self.cache:
            self.cache.move_to_end(key)
        else:
            self.cache[key] = True
            if len(self.cache) > self.max_size:
                self.cache.popitem(last=False)
        self._save()

    def generate_key(self, tx_hash: str, callback_name: str, from_addr: str, to_addr: str, value: int) -> str:
        """生成唯一键"""
        data = f"{tx_hash}:{callback_name}:{from_addr}:{to_addr}:{value}"
        return hashlib.md5(data.encode()).hexdigest()


class CallbackWatcher:
    """高可靠回调监听器"""

    def __init__(self):
        self.w3_http = None
        self.w3_ws = None
        self.token_contract = None
        self.main_contract = None
        self.account = None
        self.running = True

        # 持久化缓存
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        self.processed_cache = ProcessedCache(STATE_DIR / "processed_cache.json", PROCESSED_CACHE_SIZE)

        # 最后处理的区块
        self.last_block_file = STATE_DIR / "last_block.json"
        self.last_processed_block = self._load_last_block()

        # 连接状态
        self.ws_connected = False
        self.last_ws_activity = time.time()

        # 统计
        self.stats = {
            'events_detected': 0,
            'callbacks_executed': 0,
            'callbacks_failed': 0,
            'ws_reconnects': 0,
            'http_backscans': 0,
            'duplicates_skipped': 0
        }

    def _load_last_block(self) -> int:
        """加载最后处理的区块"""
        if self.last_block_file.exists():
            try:
                with open(self.last_block_file, 'r') as f:
                    return json.load(f).get('block', 0)
            except Exception:
                pass
        return 0

    def _save_last_block(self, block: int):
        """保存最后处理的区块"""
        try:
            with open(self.last_block_file, 'w') as f:
                json.dump({'block': block, 'updated': datetime.now(timezone.utc).isoformat()}, f)
        except Exception as e:
            logger.warning(f"⚠️ 保存区块记录失败: {e}")

    async def init_http(self) -> bool:
        """初始化 HTTP 连接"""
        from web3 import Web3
        from web3.middleware import ExtraDataToPOAMiddleware

        rpc_urls = [RPC_URL] + [r for r in RPC_FALLBACKS if r]

        for rpc_url in rpc_urls:
            try:
                self.w3_http = Web3(Web3.HTTPProvider(rpc_url))
                self.w3_http.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)

                if self.w3_http.is_connected():
                    logger.info(f"✅ HTTP RPC 已连接: {rpc_url}")
                    return True
            except Exception as e:
                logger.warning(f"❌ HTTP RPC 连接失败 {rpc_url}: {e}")

        logger.error("❌ 无法连接到任何 HTTP RPC")
        return False

    async def init_contracts(self) -> bool:
        """初始化合约"""
        from web3 import Web3

        if not ETIM_TOKEN_ADDRESS or not ETIM_MAIN_ADDRESS:
            logger.error("❌ 未配置合约地址")
            return False

        if not PRIVATE_KEY:
            logger.error("❌ 未配置私钥")
            return False

        try:
            self.token_contract = self.w3_http.eth.contract(
                address=Web3.to_checksum_address(ETIM_TOKEN_ADDRESS),
                abi=ETIM_TOKEN_ABI
            )

            self.main_contract = self.w3_http.eth.contract(
                address=Web3.to_checksum_address(ETIM_MAIN_ADDRESS),
                abi=ETIM_MAIN_ABI
            )

            self.account = self.w3_http.eth.account.from_key(PRIVATE_KEY)
            logger.info(f"📤 监听钱包: {self.account.address}")

            is_whitelisted = self.main_contract.functions.tokenCallbackWhitelist(
                self.account.address
            ).call()

            if not is_whitelisted:
                logger.error(f"❌ 钱包不在白名单中")
                return False

            logger.info(f"✅ 钱包已在白名单中")
            return True

        except Exception as e:
            logger.error(f"❌ 合约初始化失败: {e}")
            return False

    async def execute_callback(self, event: Dict[str, Any]) -> tuple:
        """执行回调"""
        from web3.exceptions import ContractLogicError

        callback_name = event['callbackName']
        from_addr = event['from']
        to_addr = event['to']
        value = event['value']

        callback_fn = getattr(self.main_contract.functions, callback_name, None)
        if callback_fn is None:
            return False, f"未知回调: {callback_name}"

        logger.info(f"🔧 执行: {callback_name}({from_addr[:10]}..., {to_addr[:10]}..., {value})")

        gas_price = self.w3_http.eth.gas_price
        max_gas = self.w3_http.to_wei(MAX_GAS_PRICE_GWEI, 'gwei')

        if gas_price > max_gas:
            return False, f"gasPrice 过高: {self.w3_http.from_wei(gas_price, 'gwei')} gwei"

        try:
            nonce = self.w3_http.eth.get_transaction_count(self.account.address)

            # 估算 gas
            try:
                estimated = callback_fn(from_addr, to_addr, value).estimate_gas({
                    'from': self.account.address
                })
                gas_limit = min(int(estimated * 1.3), GAS_LIMIT)
            except ContractLogicError as e:
                return False, f"估算失败: {e}"

            tx = callback_fn(from_addr, to_addr, value).build_transaction({
                'from': self.account.address,
                'nonce': nonce,
                'gas': gas_limit,
                'gasPrice': gas_price,
                'chainId': self.w3_http.eth.chain_id
            })

            signed = self.w3_http.eth.account.sign_transaction(tx, PRIVATE_KEY)
            tx_hash = self.w3_http.eth.send_raw_transaction(signed.raw_transaction)
            logger.info(f"📤 已发送: {tx_hash.hex()}")

            receipt = self.w3_http.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

            if receipt.status == 1:
                logger.info(f"✅ 成功! block={receipt.blockNumber}, gas={receipt.gasUsed}")
                return True, tx_hash.hex()
            else:
                return False, "交易失败"

        except Exception as e:
            return False, str(e)

    async def send_lark(self, event: Dict, success: bool, tx_hash: str = None):
        """发送飞书通知"""
        if not LARK_WEBHOOK:
            return

        import aiohttp

        title = "✅ 回调修复成功" if success else "❌ 回调修复失败"
        lines = [
            [{"tag": "text", "text": f"区块: {event.get('blockNumber', 'N/A')}"}],
            [{"tag": "text", "text": f"交易: {event['txHash']}"}],
            [{"tag": "text", "text": f"回调: {event['callbackName']}"}],
            [{"tag": "text", "text": f"value: {event['value'] / 1e18:.4f} ETIM"}],
        ]
        if tx_hash:
            lines.append([{"tag": "text", "text": f"修复: {tx_hash}"}])

        msg = {
            "msg_type": "post",
            "content": {"post": {"zh_cn": {"title": f"**{title} (BSC)**", "content": lines}}}
        }

        try:
            async with aiohttp.ClientSession() as session:
                await session.post(LARK_WEBHOOK, json=msg, timeout=10)
        except Exception as e:
            logger.warning(f"⚠️ 飞书通知失败: {e}")

    async def process_event(self, event: Dict[str, Any]):
        """处理事件"""
        # 生成唯一键
        cache_key = self.processed_cache.generate_key(
            event['txHash'], event['callbackName'],
            event['from'], event['to'], event['value']
        )

        # 去重检查
        if self.processed_cache.contains(cache_key):
            self.stats['duplicates_skipped'] += 1
            logger.debug(f"⏭️ 跳过重复: {event['txHash'][:10]}...")
            return

        self.stats['events_detected'] += 1
        logger.info(f"\n{'='*50}")
        logger.info(f"🚨 CallbackFailed: {event['callbackName']}")
        logger.info(f"   tx: {event['txHash']}")
        logger.info(f"   from: {event['from']}")
        logger.info(f"   to: {event['to']}")
        logger.info(f"   value: {event['value'] / 1e18:.6f} ETIM")

        success, result = await self.execute_callback(event)

        # 标记已处理
        self.processed_cache.add(cache_key)

        if success:
            self.stats['callbacks_executed'] += 1
            await self.send_lark(event, True, result)
        else:
            self.stats['callbacks_failed'] += 1
            logger.error(f"❌ 修复失败: {result}")
            await self.send_lark(event, False)

        # 更新区块记录
        if event.get('blockNumber'):
            self._save_last_block(event['blockNumber'])

    async def http_backscan(self, from_block: int, to_block: int):
        """HTTP 回扫补漏"""
        logger.info(f"🔄 HTTP 回扫: {from_block} - {to_block}")
        self.stats['http_backscans'] += 1

        try:
            event_filter = self.token_contract.events.CallbackFailed.create_filter(
                from_block=from_block,
                to_block=to_block
            )

            for log in event_filter.get_all_entries():
                event = {
                    'blockNumber': log.get('blockNumber', 0),
                    'txHash': log['transactionHash'].hex() if isinstance(log.get('transactionHash'), bytes) else log.get('transactionHash', ''),
                    'callbackName': log['args']['callbackName'],
                    'from': log['args']['from'],
                    'to': log['args']['to'],
                    'value': log['args']['value'],
                    'reason': log['args']['reason']
                }
                await self.process_event(event)

        except Exception as e:
            logger.error(f"❌ HTTP 回扫失败: {e}")

    async def websocket_loop(self):
        """WebSocket 主循环"""
        import aiohttp
        from web3 import Web3

        ws_urls = [WS_URL] + [w for w in WS_FALLBACKS if w]

        while self.running:
            for ws_url in ws_urls:
                try:
                    logger.info(f"🔌 连接 WebSocket: {ws_url}")

                    async with aiohttp.ClientSession() as session:
                        async with session.ws_connect(ws_url, heartbeat=WS_PING_INTERVAL) as ws:
                            self.ws_connected = True
                            self.last_ws_activity = time.time()
                            logger.info(f"✅ WebSocket 已连接")

                            # 订阅日志
                            token_addr = Web3.to_checksum_address(ETIM_TOKEN_ADDRESS).lower()
                            event_topic = Web3.keccak(text="CallbackFailed(address,address,bytes,string,uint256)").hex()

                            subscribe_msg = {
                                "jsonrpc": "2.0",
                                "id": 1,
                                "method": "eth_subscribe",
                                "params": ["logs", {
                                    "address": token_addr,
                                    "topics": [event_topic]
                                }]
                            }

                            await ws.send_json(subscribe_msg)
                            response = await ws.receive_json()
                            subscription_id = response.get('result')
                            logger.info(f"✅ 订阅成功: {subscription_id}")

                            # 消息循环
                            async for msg in ws:
                                if not self.running:
                                    break

                                self.last_ws_activity = time.time()

                                if msg.type == aiohttp.WSMsgType.TEXT:
                                    data = json.loads(msg.data)

                                    if 'params' in data:
                                        log = data['params']['result']

                                        # 解析事件
                                        try:
                                            # 解码日志
                                            event_data = self._decode_log(log)
                                            if event_data:
                                                await self.process_event(event_data)
                                        except Exception as e:
                                            logger.error(f"❌ 解析事件失败: {e}")

                                elif msg.type == aiohttp.WSMsgType.PONG:
                                    self.last_ws_activity = time.time()

                                elif msg.type == aiohttp.WSMsgType.CLOSED:
                                    break

                    self.ws_connected = False

                except Exception as e:
                    logger.error(f"❌ WebSocket 错误: {e}")
                    self.ws_connected = False

                if not self.running:
                    break

            # 断线后 HTTP 回扫补漏
            if self.running and self.last_processed_block > 0:
                current_block = self.w3_http.eth.block_number
                from_block = max(self.last_processed_block - 5, 0)
                if current_block > from_block:
                    await self.http_backscan(from_block, current_block)

            # 重连延迟
            if self.running:
                logger.warning(f"🔄 {WS_RECONNECT_DELAY}秒后重连...")
                self.stats['ws_reconnects'] += 1
                await asyncio.sleep(WS_RECONNECT_DELAY)

    def _decode_log(self, log: dict) -> Optional[Dict]:
        """解码日志"""
        try:
            from web3 import Web3

            # 解析 topics
            topics = log.get('topics', [])
            data = log.get('data', '0x')

            # CallbackFailed 是非索引参数在 data 中
            # topics[1] = from (indexed), topics[2] = to (indexed)
            from_addr = '0x' + topics[1][-40:].hex() if len(topics) > 1 else ''
            to_addr = '0x' + topics[2][-40:].hex() if len(topics) > 2 else ''

            # 解码 data (callbackName, value, reason)
            # 使用 web3 解码
            decoded = self.w3_http.codec.decode(
                ['string', 'uint256', 'bytes'],
                bytes.fromhex(data[2:])
            )

            return {
                'blockNumber': int(log.get('blockNumber', '0x0'), 16),
                'txHash': log.get('transactionHash', ''),
                'callbackName': decoded[0],
                'from': Web3.to_checksum_address(from_addr),
                'to': Web3.to_checksum_address(to_addr),
                'value': decoded[1],
                'reason': decoded[2]
            }
        except Exception as e:
            logger.warning(f"⚠️ 解码失败: {e}")
            return None

    def print_stats(self):
        """打印统计"""
        logger.info("\n" + "="*50)
        logger.info("📊 统计信息")
        logger.info(f"   检测事件: {self.stats['events_detected']}")
        logger.info(f"   回调成功: {self.stats['callbacks_executed']}")
        logger.info(f"   回调失败: {self.stats['callbacks_failed']}")
        logger.info(f"   跳过重复: {self.stats['duplicates_skipped']}")
        logger.info(f"   WS重连: {self.stats['ws_reconnects']}")
        logger.info(f"   HTTP回扫: {self.stats['http_backscans']}")

    async def run(self):
        """运行"""
        if not await self.init_http():
            sys.exit(1)

        if not await self.init_contracts():
            sys.exit(1)

        # 信号处理
        loop = asyncio.get_event_loop()

        def stop():
            logger.info("\n🛑 正在停止...")
            self.running = False

        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, stop)

        logger.info(f"\n🚀 启动高可靠监听服务")
        logger.info(f"   Token: {ETIM_TOKEN_ADDRESS}")
        logger.info(f"   Main: {ETIM_MAIN_ADDRESS}")
        logger.info(f"   持久化目录: {STATE_DIR}")

        try:
            await self.websocket_loop()
        finally:
            self.print_stats()


def lambda_handler(event, context):
    """Lambda 入口"""
    import asyncio

    async def run_lambda():
        watcher = CallbackWatcher()

        if not await watcher.init_http():
            return {"statusCode": 500, "body": "HTTP 连接失败"}

        if not await watcher.init_contracts():
            return {"statusCode": 500, "body": "合约初始化失败"}

        scan_blocks = event.get('scanBlocks', 100) if event else 100
        current = watcher.w3_http.eth.block_number
        from_block = current - scan_blocks

        await watcher.http_backscan(from_block, current)
        watcher.print_stats()

        return {"statusCode": 200, "body": watcher.stats}

    return asyncio.run(run_lambda())


def main():
    parser = argparse.ArgumentParser(description='ETIM CallbackFailed 监听服务 (高可靠版)')
    parser.add_argument('--lambda-test', action='store_true', help='Lambda 测试')
    args = parser.parse_args()

    if args.lambda_test:
        result = lambda_handler({'scanBlocks': 100}, None)
        print(json.dumps(result, indent=2, default=str))
    else:
        asyncio.run(CallbackWatcher().run())


if __name__ == "__main__":
    main()
