'use client';

import Link from 'next/link';
import { ConnectButton } from '@/components/ConnectButton';
import { useAccount } from 'wagmi';
import { useTranslation } from '@/lib/i18n';

export function HeroSection() {
  const { isConnected } = useAccount();
  const { t } = useTranslation();

  return (
    <section className="relative overflow-hidden py-24 sm:py-32">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-4 py-1.5 mb-8">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          <span className="text-indigo-300 text-sm">{t('hero.badge')}</span>
        </div>

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
          {isConnected ? (
            <Link
              href="/dashboard"
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-xl font-semibold transition-colors"
            >
              {t('hero.dashboardCta')}
            </Link>
          ) : (
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
            { label: t('hero.miningPool'), value: '87.9%' },
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
