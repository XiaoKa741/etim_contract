#!/usr/bin/env python3
"""
ETIMMain.triggerLpBurnAllocation() AWS Lambda 版本 (BSC)
通过 EventBridge 每分钟触发一次
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
CONTRACT_ADDRESS = os.getenv("BSC_CONTRACT_ADDRESS", "0xEA2530ADFb90b41c4b19EC6D121c42D3Df5696aa")
LARK_WEBHOOK = os.getenv("LARK_WEBHOOK", "")

# ABI
CONTRACT_ABI = [
    {"inputs": [], "name": "pendingLpEth", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "pendingSwapBurnEth", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "lpBurnLastTrigger", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "lpBurnCooldown", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "lpBurnManualRatio", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "triggerLpBurnAllocation", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"anonymous": False, "inputs": [
        {"indexed": True, "name": "caller", "type": "address"},
        {"indexed": False, "name": "lpAmount", "type": "uint256"},
        {"indexed": False, "name": "swapBurnAmount", "type": "uint256"}
    ], "name": "LpBurnManualTriggered", "type": "event"},
]

CONTRACT_ERRORS = ["NothingPending", "CooldownNotElapsed", "InvalidParams"]

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
                    "title": "**❌ ETIM LP+Burn 失败 (BSC)**",
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
def get_contract_state(w3: Web3, contract) -> dict:
    return {
        "pendingLpEth": contract.functions.pendingLpEth().call(),
        "pendingSwapBurnEth": contract.functions.pendingSwapBurnEth().call(),
        "lpBurnLastTrigger": contract.functions.lpBurnLastTrigger().call(),
        "lpBurnCooldown": contract.functions.lpBurnCooldown().call(),
        "lpBurnManualRatio": contract.functions.lpBurnManualRatio().call(),
    }


def check_can_call(state: dict, block_timestamp: int) -> tuple[bool, str]:
    pending_lp = state["pendingLpEth"]
    pending_burn = state["pendingSwapBurnEth"]
    ratio = state["lpBurnManualRatio"]
    last_trigger = state["lpBurnLastTrigger"]
    cooldown = state["lpBurnCooldown"]

    if pending_lp == 0 and pending_burn == 0:
        return False, "NothingPending"

    if ratio == 0:
        return False, "RatioDisabled"

    if block_timestamp < last_trigger + cooldown:
        remaining = (last_trigger + cooldown) - block_timestamp
        return False, f"CooldownRemaining: {remaining}s"

    return True, "OK"


def is_contract_error(error: Exception) -> bool:
    error_str = str(error).lower()
    for err_name in CONTRACT_ERRORS:
        if err_name.lower() in error_str:
            return True
    return False


def trigger_lp_burn(w3: Web3, contract, account) -> Optional[dict]:
    """执行 triggerLpBurnAllocation()"""
    logger.info("🚀 开始执行 triggerLpBurnAllocation()")

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
        estimated_gas = contract.functions.triggerLpBurnAllocation().estimate_gas({"from": account.address})
        gas_limit = min(int(estimated_gas * 1.3), GAS_LIMIT)  # 加 30% buffer，但不超过上限
        logger.info(f"⛽ estimatedGas: {estimated_gas}, gasLimit: {gas_limit}")
    except Exception as e:
        logger.warning(f"⚠️ gas 估算失败，使用默认值: {e}")
        gas_limit = GAS_LIMIT

    try:
        tx = contract.functions.triggerLpBurnAllocation().build_transaction({
            "from": account.address,
            "nonce": nonce,
            "gas": gas_limit,
            "gasPrice": gas_price,
            "chainId": w3.eth.chain_id
        })
    except ContractLogicError as e:
        if is_contract_error(e):
            logger.info(f"ℹ️ 合约条件不满足: {e}")
            return None
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

    # 解析事件
    lp_amount, swap_burn_amount = 0, 0
    for log in receipt.logs:
        try:
            parsed = contract.events.LpBurnManualTriggered().process_log(log)
            lp_amount = parsed['args']['lpAmount']
            swap_burn_amount = parsed['args']['swapBurnAmount']
            break
        except Exception:
            pass

    return {
        'lpAmount': lp_amount,
        'swapBurnAmount': swap_burn_amount,
        'txHash': tx_hash.hex()
    }


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

        # 获取状态
        block_timestamp = w3.eth.get_block('latest')['timestamp']
        state = get_contract_state(w3, contract)

        logger.info(f"📊 pendingLp: {w3.from_wei(state['pendingLpEth'], 'ether')} ETH, "
                    f"pendingBurn: {w3.from_wei(state['pendingSwapBurnEth'], 'ether')} ETH, "
                    f"ratio: {state['lpBurnManualRatio']}")

        # 检查条件
        can_call, reason = check_can_call(state, block_timestamp)

        if not can_call:
            logger.info(f"⏳ 条件不满足: {reason}")
            result["body"]["action"] = "skipped"
            result["body"]["message"] = reason
            return result

        # 执行
        logger.info("✅ 条件满足，执行调用...")
        exec_result = trigger_lp_burn(w3, contract, account)

        if exec_result:
            logger.info(f"✅ 执行成功: LP {w3.from_wei(exec_result['lpAmount'], 'ether')} ETH, "
                        f"Burn {w3.from_wei(exec_result['swapBurnAmount'], 'ether')} ETH")
            result["body"]["action"] = "executed"
            result["body"]["success"] = True
            result["body"]["message"] = f"LP: {w3.from_wei(exec_result['lpAmount'], 'ether')} ETH, Burn: {w3.from_wei(exec_result['swapBurnAmount'], 'ether')} ETH"
            result["body"]["txHash"] = exec_result['txHash']
        else:
            result["body"]["action"] = "skipped"
            result["body"]["message"] = "合约条件不满足或 gasPrice 过高"

    except ContractLogicError as e:
        if is_contract_error(e):
            logger.info(f"ℹ️ 合约错误: {e}")
            result["body"]["action"] = "skipped"
            result["body"]["message"] = str(e)
        else:
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
