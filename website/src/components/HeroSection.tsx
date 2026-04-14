'use client';

import Link from 'next/link';
import { ConnectButton } from '@/components/ConnectButton';
import { useAccount } from 'wagmi';
import { useTranslation } from '@/lib/i18n';
import { CONTRACTS } from '@/config/contracts';
import { useState } from 'react';

export function HeroSection() {
  const { isConnected } = useAccount();
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copyMainContract = async () => {
    try {
      await navigator.clipboard.writeText(CONTRACTS.ETIMMain);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <section className="relative overflow-hidden py-24 sm:py-32">
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-64 sm:w-96 h-64 sm:h-96 bg-indigo-500/20 rounded-full blur-3xl will-change-transform" />
        <div className="absolute bottom-1/4 right-1/4 w-64 sm:w-96 h-64 sm:h-96 bg-purple-500/20 rounded-full blur-3xl will-change-transform" />
      </div>

      <div className="max-w-7xl mx-auto px-6 sm:px-6 lg:px-8 text-center">
        <button
          onClick={copyMainContract}
          className="relative mx-auto mb-8 w-full max-w-2xl bg-gray-900/60 border border-indigo-500/30 hover:border-indigo-400/60 rounded-xl px-4 py-3 transition-colors"
        >
          <span className="absolute top-3 right-3 inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-3 py-1 text-sm font-medium text-emerald-300">
            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            BNB
          </span>
          <div className="text-sm sm:text-base text-gray-300 mb-1">{t('hero.mainContract')}</div>
          <div className="text-sm sm:text-base font-medium text-indigo-200 break-all">{CONTRACTS.ETIMMain}</div>
          <div className="mt-1 text-xs sm:text-sm text-green-400">{copied ? t('hero.copied') : t('hero.tapToCopy')}</div>
        </button>

        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-4">
          <span className="bg-gradient-to-r from-white via-indigo-200 to-purple-200 bg-clip-text text-transparent">
            {t('hero.title')}
          </span>
        </h1>

        <p className="text-base sm:text-lg text-indigo-300/80 font-medium mb-4">
          {t('hero.tagline')}
        </p>

        <p className="text-lg sm:text-xl text-gray-400 max-w-3xl mx-auto mb-4">
          {t('hero.subtitle')}
        </p>

        <p className="text-sm text-gray-500 max-w-xl mx-auto mb-10">
          {t('hero.description')}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/dashboard"
            className={
              isConnected
                ? "bg-orange-500 hover:bg-orange-400 text-white px-8 py-3 rounded-xl font-semibold transition-colors shadow-lg shadow-orange-500/25"
                : "bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-xl font-semibold transition-colors"
            }
          >
            {t('hero.dashboardCta')}
          </Link>
          {!isConnected && (
            <ConnectButton label={t('hero.connectCta')} />
          )}
          <Link
            href="/whitepaper"
            className="border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white px-8 py-3 rounded-xl font-semibold transition-colors"
          >
            {t('hero.whitepaperCta')}
          </Link>
        </div>

        <div className="mt-16 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl mx-auto">
          {[
            { label: t('hero.totalSupply'), value: '100M ETIM' },
            { label: t('hero.miningPool'), value: '84.9%' },
            { label: t('hero.depositRange'), value: '$100-$150' },
            { label: t('hero.nodeNfts'), value: '500 Max' },
          ].map((stat) => (
            <div key={stat.label} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
              <div className="text-xl sm:text-2xl font-bold text-white">{stat.value}</div>
              <div className="text-sm text-gray-400">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
