'use client';

import { CONTRACTS } from '@/config/contracts';
import { useTranslation } from '@/lib/i18n';
import { useLevelConditions } from '@/hooks/useLevelConditions';

export default function WhitepaperPage() {
  const { t } = useTranslation();
  const levelConditions = useLevelConditions();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-3xl sm:text-4xl font-bold mb-2">{t('wp.title')}</h1>
      <p className="text-gray-400 mb-12">{t('wp.subtitle')}</p>

      <div className="prose prose-invert max-w-none space-y-12">
        <section>
          <h2 className="text-2xl font-bold text-white mb-4">1. {t('wp.overview')}</h2>
          <p className="text-gray-300 leading-relaxed">
            ETIM (Eternal Imprint) is a decentralized participation and mining ecosystem built on BNB Chain (BSC).
            Users deposit ETH to mine ETIM tokens through a growth pool mechanism. The system features a
            7-tier level structure (S0-S6), an on-chain referral network, Node NFTs for enhanced rewards,
            and automated PancakeSwap v4 liquidity management with a built-in tax hook.
          </p>
          <p className="text-gray-300 leading-relaxed mt-3">
            The protocol is designed to be fully on-chain with no centralized control over user funds.
            All reward calculations, level determinations, and distribution logic execute through verified smart contracts.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-white mb-4">2. {t('wp.tokenEconomics')}</h2>
          <p className="text-gray-300 leading-relaxed mb-4">
            ETIM has a fixed total supply of <strong className="text-white">100,000,000 tokens</strong> with no inflation mechanism.
          </p>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400">
                  <th className="text-left py-2">Allocation</th>
                  <th className="text-right py-2">Amount</th>
                  <th className="text-right py-2">%</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                <tr className="border-b border-gray-700/50"><td className="py-2">Growth Pool (Mining)</td><td className="text-right">84,900,000</td><td className="text-right">84.9%</td></tr>
                <tr className="border-b border-gray-700/50"><td className="py-2">Market Infrastructure</td><td className="text-right">5,000,000</td><td className="text-right">5%</td></tr>
                <tr className="border-b border-gray-700/50"><td className="py-2">Airdrop</td><td className="text-right">5,000,000</td><td className="text-right">5%</td></tr>
                <tr className="border-b border-gray-700/50"><td className="py-2">Ecosystem Fund</td><td className="text-right">1,000,000</td><td className="text-right">1%</td></tr>
                <tr className="border-b border-gray-700/50"><td className="py-2">Community Fund</td><td className="text-right">4,000,000</td><td className="text-right">4%</td></tr>
                <tr><td className="py-2">Ethereum Foundation</td><td className="text-right">100,000</td><td className="text-right">0.1%</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-white mb-4">3. {t('wp.miningMechanism')}</h2>
          <p className="text-gray-300 leading-relaxed mb-3">
            Users deposit <strong className="text-white">$100-$150</strong> worth of ETH (one-time per address) to enter the mining pool.
          </p>
          <ul className="list-disc list-inside text-gray-300 space-y-2">
            <li>Base daily mining rate: 0.1% of principal USD value</li>
            <li>Higher levels provide acceleration bonuses (up to +21% at S6)</li>
            <li>Mining continues until the claimed USD value equals the invested USD value</li>
            <li>Once the growth pool is depleted, PancakeSwap trading is unlocked</li>
          </ul>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">ETH Deposit Allocation</h3>
          <ul className="list-disc list-inside text-gray-300 space-y-2">
            <li><strong className="text-white">69%</strong> — PancakeSwap liquidity pool injection</li>
            <li><strong className="text-white">25%</strong> — Token burn (sent to dead address)</li>
            <li><strong className="text-white">2.5%</strong> — S2+ player ETH dividends</li>
            <li><strong className="text-white">1.5%</strong> — Foundation rewards</li>
            <li><strong className="text-white">1%</strong> — Node NFT holder rewards</li>
            <li><strong className="text-white">1%</strong> — Pot and official rewards</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-white mb-4">4. {t('wp.levelSystem')}</h2>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400">
                  <th className="text-left py-2">Level</th>
                  <th className="text-right py-2">Referrals</th>
                  <th className="text-right py-2">Personal</th>
                  <th className="text-right py-2">Team</th>
                  <th className="text-right py-2">Boost</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {levelConditions.map((lvl, i) => (
                  <tr key={lvl.level} className={i < 6 ? 'border-b border-gray-700/50' : ''}>
                    <td className="py-2">{lvl.level}</td>
                    <td className="text-right">{lvl.referrals}</td>
                    <td className="text-right">{lvl.personal}</td>
                    <td className="text-right">{lvl.team}</td>
                    <td className="text-right text-green-400">+{lvl.acceleration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-white mb-4">5. {t('wp.referralSystem')}</h2>
          <ol className="list-decimal list-inside text-gray-300 space-y-2">
            <li>User A (referrer) sends any amount of ETIM to User B</li>
            <li>User B sends any amount of ETIM back to User A</li>
            <li>This establishes A as B&apos;s referrer permanently on-chain</li>
          </ol>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-white mb-4">6. {t('wp.nodeNfts')}</h2>
          <ul className="list-disc list-inside text-gray-300 space-y-2">
            <li>Maximum of <strong className="text-white">500 Node NFTs</strong>, each priced at $1,000</li>
            <li>Each Node NFT provides 300M mining power units</li>
            <li>1% of every ETH deposit is distributed to node holders proportionally</li>
            <li>Requires S1 level activation to receive node rewards</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-white mb-4">7. {t('wp.uniswapIntegration')}</h2>
          <ul className="list-disc list-inside text-gray-300 space-y-2">
            <li>Buy fee: 3% — Distributed to rewards pools</li>
            <li>Sell fee: 3% — Distributed to rewards pools</li>
            <li>69% of deposits automatically inject into PancakeSwap LP</li>
            <li>25% of deposits used to buy and burn ETIM</li>
            <li>Trading unlocks only after the growth pool is depleted</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-white mb-4">8. {t('wp.smartContracts')}</h2>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 space-y-3">
            {Object.entries(CONTRACTS).map(([name, address]) => (
              <div key={name} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                <span className="text-gray-400 text-sm w-36">{name}</span>
                <a href={`https://bscscan.com/address/${address}`} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 font-mono text-sm break-all">{address}</a>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
