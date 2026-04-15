#!/usr/bin/env python3
"""
ETIMMain.updateDailyPrice() AWS Lambda 版本 (BSC)
通过 EventBridge 每天 UTC 0点触发
"""
import os
import json
import logging
import requests
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv
from web3 import Web3
from web3.exceptions import ContractLogicError
from web3.middleware import ExtraDataToPOAMiddleware

# 加载.env（Lambda 环境变量通过 AWS 控制台设置）
load_dotenv()

# ============== 配置 ==============
RPC_URL = os.getenv("BSC_RPC_URL", "https://bsc-dataseed1.binance.org")
PRIVATE_KEY = os.getenv("PRIVATE_KEY", "")
CONTRACT_ADDRESS = os.getenv("BSC_CONTRACT_ADDRESS", "")
LARK_WEBHOOK = os.getenv("LARK_WEBHOOK", "")

# ABI
CONTRACT_ABI = [
    {"inputs": [], "name": "updateDailyPrice", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "", "type": "uint256"}], "name": "dailyEthEtimPrice", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"name": "", "type": "uint256"}], "name": "dailyUsdEtimPrice", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "dailyCapUpdatedDay", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
]

# Gas 配置 (BSC 传统模式)
MAX_GAS_PRICE_GWEI = 5  # BSC gasPrice 上限
GAS_LIMIT = 500000

# ============== 日志配置 ==============
logger = logging.getLogger()
logger.setLevel(logging.INFO)


# ============== Web3 初始化 ==============
def get_web3() -> Web3:
    if not RPC_URL:
        raise ValueError("BSC_RPC_URL 未配置")
    if not PRIVATE_KEY:
        raise ValueError("PRIVATE_KEY 未配置")
    if not CONTRACT_ADDRESS:
        raise ValueError("BSC_CONTRACT_ADDRESS 未配置")

    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)  # BSC 是 POA 链
    if not w3.is_connected():
        raise ConnectionError("无法连接到BSC RPC")
    return w3


def get_contract(w3: Web3):
    return w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESS), abi=CONTRACT_ABI)


# ============== 飞书通知（仅失败时调用）==============
def notify_failure(error: str, wallet_address: str, chain_id: int = None):
    if not LARK_WEBHOOK:
        logger.warning("LARK_WEBHOOK 未配置")
        return

    content_lines = [
        [{"tag": "text", "text": f"链: BSC (chainId: {chain_id})"}] if chain_id else None,
        [{"tag": "text", "text": f"钱包: {wallet_address}"}],
        [{"tag": "text", "text": f"执行失败: {error}"}]
    ]
    # 过滤掉 None
    content_lines = [line for line in content_lines if line is not None]

    msg = {
        "msg_type": "post",
        "content": {
            "post": {
                "zh_cn": {
                    "title": "**❌ ETIM Daily Price 失败 (BSC)**",
                    "content": content_lines
                }
            }
        }
    }

    try:
        response = requests.post(LARK_WEBHOOK, headers={"Content-Type": "application/json"}, data=json.dumps(msg), timeout=10)
        if response.status_code == 200:
            logger.info("📨 飞书通知已发送")
        else:
            logger.warning(f"⚠️ 飞书通知失败: {response.status_code}")
    except Exception as e:
        logger.warning(f"⚠️ 飞书通知异常: {e}")


# ============== 核心逻辑 ==============
def check_already_updated(w3: Web3, contract) -> tuple[bool, int, str]:
    """
    检查今天是否已更新价格（三个条件都满足才跳过）
    - dailyEthEtimPrice[currentDay] != 0
    - dailyUsdEtimPrice[currentDay] != 0
    - dailyCapUpdatedDay == currentDay

    返回: (已更新?, currentDay, reason)
    """
    block_timestamp = w3.eth.get_block('latest')['timestamp']
    current_day = block_timestamp // 86400  # 1 days = 86400 seconds

    # 检查三个条件
    eth_price = contract.functions.dailyEthEtimPrice(current_day).call()
    usd_price = contract.functions.dailyUsdEtimPrice(current_day).call()
    cap_day = contract.functions.dailyCapUpdatedDay().call()

    checks = [
        ("dailyEthEtimPrice", eth_price > 0),
        ("dailyUsdEtimPrice", usd_price > 0),
        ("dailyCapUpdatedDay", cap_day == current_day),
    ]

    all_satisfied = all(check[1] for check in checks)

    if all_satisfied:
        return True, current_day, "所有条件已满足"
    else:
        failed = [check[0] for check in checks if not check[1]]
        return False, current_day, f"未满足: {', '.join(failed)}"


def update_daily_price(w3: Web3, contract, account) -> Optional[str]:
    """执行 updateDailyPrice()"""
    logger.info("🚀 开始执行 updateDailyPrice()")

    # BSC 使用传统 gasPrice（非 EIP-1559）
    gas_price = w3.eth.gas_price
    max_gas_price = w3.to_wei(MAX_GAS_PRICE_GWEI, 'gwei')

    if gas_price > max_gas_price:
        logger.warning(f"⚠️ gasPrice 过高: {w3.from_wei(gas_price, 'gwei')} > {MAX_GAS_PRICE_GWEI} gwei，跳过")
        return None

    gas_price = min(gas_price, max_gas_price)
    logger.info(f"⛽ gasPrice: {w3.from_wei(gas_price, 'gwei')} gwei")

    # 构建交易
    nonce = w3.eth.get_transaction_count(account.address)

    # 动态估算 gas
    try:
        estimated_gas = contract.functions.updateDailyPrice().estimate_gas({"from": account.address})
        gas_limit = min(int(estimated_gas * 1.3), GAS_LIMIT)
        logger.info(f"⛽ estimatedGas: {estimated_gas}, gasLimit: {gas_limit}")
    except Exception as e:
        logger.warning(f"⚠️ gas 估算失败，使用默认值: {e}")
        gas_limit = GAS_LIMIT

    try:
        tx = contract.functions.updateDailyPrice().build_transaction({
            "from": account.address,
            "nonce": nonce,
            "gas": gas_limit,
            "gasPrice": gas_price,
            "chainId": w3.eth.chain_id
        })
    except ContractLogicError as e:
        logger.error(f"❌ 合约执行错误: {e}")
        raise

    # 签名并发送
    signed_tx = w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
    tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
    logger.info(f"📤 交易已发送: {tx_hash.hex()}")

    # 等待确认（3分钟超时）
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=180, poll_latency=5)

    if receipt.status != 1:
        raise Exception("交易失败，status=0")

    logger.info(f"✅ 成功! block: {receipt.blockNumber}, gas: {receipt.gasUsed}")
    return tx_hash.hex()


# ============== Lambda Handler ==============
def lambda_handler(event, context):
    """AWS Lambda 入口函数"""
    logger.info("=" * 50)
    logger.info(f"🕐 Lambda 触发时间: {datetime.now(timezone.utc).isoformat()}")

    result = {
        "statusCode": 200,
        "body": {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "action": None,
            "success": False,
            "message": "",
            "txHash": None
        }
    }

    try:
        w3 = get_web3()
        contract = get_contract(w3)
        account = w3.eth.account.from_key(PRIVATE_KEY)
        logger.info(f"📤 账户: {account.address}")

        # 检查今天是否已更新
        already_updated, current_day, reason = check_already_updated(w3, contract)
        logger.info(f"📅 当前日期 (UTC): day {current_day}")

        if already_updated:
            logger.info(f"⏳ 今天已经更新过价格，跳过执行 ({reason})")
            result["body"]["action"] = "skipped"
            result["body"]["message"] = f"已更新: {reason}"
            return result

        logger.info(f"📊 检查结果: {reason}")

        # 执行
        tx_hash = update_daily_price(w3, contract, account)

        if tx_hash:
            logger.info(f"✅ 执行成功: txHash: {tx_hash}")
            result["body"]["action"] = "executed"
            result["body"]["success"] = True
            result["body"]["message"] = "updateDailyPrice 执行成功"
            result["body"]["txHash"] = tx_hash
        else:
            result["body"]["action"] = "skipped"
            result["body"]["message"] = "gasPrice 过高，跳过执行"

    except ContractLogicError as e:
        logger.error(f"❌ 合约执行错误: {e}")
        notify_failure(str(e), account.address, w3.eth.chain_id)
        result["body"]["action"] = "error"
        result["body"]["message"] = str(e)
        result["statusCode"] = 500

    except Exception as e:
        logger.error(f"❌ 执行异常: {e}")
        wallet = account.address if 'account' in dir() else "N/A"
        chain_id = w3.eth.chain_id if 'w3' in dir() else None
        notify_failure(str(e), wallet, chain_id)
        result["body"]["action"] = "error"
        result["body"]["message"] = str(e)
        result["statusCode"] = 500

    logger.info(f"📤 返回结果: {result}")
    return result


# ============== 本地测试 ==============
if __name__ == "__main__":
    test_event = {"version": "0", "detail-type": "Scheduled Event", "source": "aws.events"}
    response = lambda_handler(test_event, None)
    print("\n" + "=" * 50)
    print("Response:")
    print(json.dumps(response, indent=2, default=str))
