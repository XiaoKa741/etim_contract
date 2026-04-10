'use client';

import { useTranslation } from '@/lib/i18n';

const placeholders = [
  { title: 'ETIM Launch Event', color: 'from-indigo-600 to-purple-600' },
  { title: 'Community Meetup', color: 'from-blue-600 to-cyan-600' },
  { title: 'Node Sale Announcement', color: 'from-green-600 to-emerald-600' },
  { title: 'Partnership Reveal', color: 'from-orange-600 to-red-600' },
  { title: 'Mining Dashboard Preview', color: 'from-pink-600 to-rose-600' },
  { title: 'Token Burn Event', color: 'from-red-600 to-orange-600' },
  { title: 'S6 Achievement Banner', color: 'from-yellow-600 to-amber-600' },
  { title: 'PancakeSwap v4 Integration', color: 'from-purple-600 to-indigo-600' },
  { title: 'Referral Program', color: 'from-cyan-600 to-blue-600' },
  { title: 'ETIM Ecosystem Map', color: 'from-emerald-600 to-green-600' },
  { title: 'Level System Infographic', color: 'from-violet-600 to-purple-600' },
  { title: 'Tokenomics Overview', color: 'from-teal-600 to-cyan-600' },
];

export default function GalleryPage() {
  const { t } = useTranslation();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-12">
        <h1 className="text-3xl sm:text-4xl font-bold mb-3">{t('gallery.title')}</h1>
        <p className="text-gray-400">{t('gallery.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {placeholders.map((item, i) => (
          <div key={i} className="group relative aspect-[4/3] rounded-xl overflow-hidden border border-gray-700/50 hover:border-indigo-500/30 transition-colors">
            <div className={`absolute inset-0 bg-gradient-to-br ${item.color} opacity-80 group-hover:opacity-100 transition-opacity`} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center px-4">
                <div className="w-16 h-16 mx-auto mb-4 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-sm">
                  <svg className="w-8 h-8 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V5.25a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v14.25a1.5 1.5 0 001.5 1.5z" />
                  </svg>
                </div>
                <h3 className="text-white font-semibold text-lg">{item.title}</h3>
                <p className="text-white/60 text-sm mt-1">{t('gallery.comingSoon')}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
