#!/usr/bin/env python3
"""
ETIMMain 每日提现脚本 (BSC) - AWS Lambda 版本
每天 UTC 0点触发，执行 withdrawFoundation、withdrawPot、withdrawOfficial
"""
import os
import json
import logging
import requests
from datetime import datetime, timezone
from typing import Optional, List, Tuple

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
    # State variables
    {"inputs": [], "name": "foundationWithdrawAddr", "outputs": [{"type": "address"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "potWithdrawAddr", "outputs": [{"type": "address"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "officialWithdrawAddr", "outputs": [{"type": "address"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "foundationRewardEth", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "potRewardEth", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "officialRewardEth", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    # Write functions
    {"inputs": [], "name": "withdrawFoundation", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "withdrawPot", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "withdrawOfficial", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
]

# Gas 配置 (BSC 传统模式)
MAX_GAS_PRICE_GWEI = 5  # BSC gasPrice 上限
GAS_LIMIT = 300000

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


# ============== 飞书通知 ==============
def notify_lark(title: str, content_lines: List[List[dict]]):
    """发送飞书通知"""
    if not LARK_WEBHOOK:
        logger.warning("LARK_WEBHOOK 未配置")
        return

    msg = {
        "msg_type": "post",
        "content": {
            "post": {
                "zh_cn": {
                    "title": title,
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


def notify_success(results: List[dict], wallet_address: str):
    """发送成功通知"""
    content_lines = [[{"tag": "text", "text": f"钱包: {wallet_address}"}]]

    for r in results:
        if r["success"]:
            content_lines.append([{"tag": "text", "text": f"✅ {r['name']}: {r['amount']} ETH"}])

    notify_lark("**✅ ETIM 每日提现成功 (BSC)**", content_lines)


def notify_failure(error: str, wallet_address: str, chain_id: int = None):
    """发送失败通知"""
    content_lines = [
        [{"tag": "text", "text": f"链: BSC (chainId: {chain_id})"}] if chain_id else None,
        [{"tag": "text", "text": f"钱包: {wallet_address}"}],
        [{"tag": "text", "text": f"执行失败: {error}"}]
    ]
    content_lines = [line for line in content_lines if line is not None]
    notify_lark("**❌ ETIM 每日提现失败 (BSC)**", content_lines)


# ============== 核心逻辑 ==============
def check_withdraw_status(contract) -> List[Tuple[str, str, int, bool]]:
    """
    检查三个提现的状态
    返回: [(name, addr, amount, can_withdraw), ...]
    """
    ZERO_ADDR = "0x0000000000000000000000000000000000000000"

    withdraws = [
        ("foundation", "foundationWithdrawAddr", "foundationRewardEth"),
        ("pot", "potWithdrawAddr", "potRewardEth"),
        ("official", "officialWithdrawAddr", "officialRewardEth"),
    ]

    results = []
    for name, addr_func, amount_func in withdraws:
        addr = contract.functions[addr_func]().call()
        amount = contract.functions[amount_func]().call()
        can_withdraw = addr != ZERO_ADDR and amount > 0
        results.append((name, addr, amount, can_withdraw))

    return results


def execute_withdraw(w3: Web3, contract, account, withdraw_name: str, amount: int) -> Optional[str]:
    """执行单个提现操作"""
    func_map = {
        "foundation": contract.functions.withdrawFoundation,
        "pot": contract.functions.withdrawPot,
        "official": contract.functions.withdrawOfficial,
    }

    if withdraw_name not in func_map:
        raise ValueError(f"未知的提现类型: {withdraw_name}")

    logger.info(f"🚀 开始执行 withdraw{withdraw_name.capitalize()}(), 金额: {w3.from_wei(amount, 'ether')} ETH")

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
        estimated_gas = func_map[withdraw_name]().estimate_gas({"from": account.address})
        gas_limit = min(int(estimated_gas * 1.3), GAS_LIMIT)
        logger.info(f"⛽ estimatedGas: {estimated_gas}, gasLimit: {gas_limit}")
    except Exception as e:
        logger.warning(f"⚠️ gas 估算失败，使用默认值: {e}")
        gas_limit = GAS_LIMIT

    try:
        tx = func_map[withdraw_name]().build_transaction({
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
            "withdraws": [],
            "success": True,
            "message": ""
        }
    }

    try:
        w3 = get_web3()
        contract = get_contract(w3)
        account = w3.eth.account.from_key(PRIVATE_KEY)
        logger.info(f"📤 账户: {account.address}")

        # 检查提现状态
        status = check_withdraw_status(contract)

        withdraw_results = []
        executed = []

        for name, addr, amount, can_withdraw in status:
            amount_eth = float(w3.from_wei(amount, 'ether'))
            withdraw_results.append({
                "name": name,
                "address": addr,
                "amount": amount_eth,
                "canWithdraw": can_withdraw,
                "success": False,
                "txHash": None
            })

            if can_withdraw:
                logger.info(f"📊 {name}: {amount_eth} ETH -> {addr}")

        # 按顺序执行提现
        for i, (name, addr, amount, can_withdraw) in enumerate(status):
            if not can_withdraw:
                logger.info(f"⏭️ {name}: 跳过 (金额为0或地址无效)")
                continue

            try:
                tx_hash = execute_withdraw(w3, contract, account, name, amount)
                if tx_hash:
                    withdraw_results[i]["success"] = True
                    withdraw_results[i]["txHash"] = tx_hash
                    executed.append({
                        "name": name,
                        "amount": withdraw_results[i]["amount"],
                        "txHash": tx_hash
                    })
            except Exception as e:
                logger.error(f"❌ {name} 提现失败: {e}")
                withdraw_results[i]["error"] = str(e)
                # 继续执行下一个，不中断

        result["body"]["withdraws"] = withdraw_results

        if executed:
            result["body"]["message"] = f"成功执行 {len(executed)} 个提现"
            notify_success(withdraw_results, account.address)
        else:
            result["body"]["message"] = "无需提现（所有金额为0或地址无效）"

    except ContractLogicError as e:
        logger.error(f"❌ 合约执行错误: {e}")
        notify_failure(str(e), account.address, w3.eth.chain_id)
        result["body"]["success"] = False
        result["body"]["message"] = str(e)
        result["statusCode"] = 500

    except Exception as e:
        logger.error(f"❌ 执行异常: {e}")
        wallet = account.address if 'account' in dir() else "N/A"
        chain_id = w3.eth.chain_id if 'w3' in dir() else None
        notify_failure(str(e), wallet, chain_id)
        result["body"]["success"] = False
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
