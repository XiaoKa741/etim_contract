'use client';

import { CONTRACTS } from '@/config/contracts';
import { useTranslation } from '@/lib/i18n';

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="bg-gray-900 border-t border-gray-800 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-white text-sm">E</div>
              <span className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">ETIM</span>
            </div>
            <p className="text-gray-400 text-sm">{t('footer.description')}</p>
          </div>
          <div>
            <h3 className="text-white font-semibold mb-4">{t('footer.contracts')}</h3>
            <div className="space-y-2 text-sm">
              {Object.entries(CONTRACTS).map(([name, address]) => (
                <div key={name} className="flex items-center gap-1.5">
                  <span className="text-gray-400">{name}: </span>
                  <a href={`https://bscscan.com/address/${address}`} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 font-mono text-xs underline underline-offset-2">
                    {address}
                  </a>
                  <button
                    onClick={() => navigator.clipboard.writeText(address)}
                    className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
                    title="Copy"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-white font-semibold mb-4">{t('footer.links')}</h3>
            <div className="space-y-2 text-sm">
              <a href="#" className="block text-gray-400 hover:text-white transition-colors">Twitter / X</a>
              <a href="#" className="block text-gray-400 hover:text-white transition-colors">Telegram</a>
              <a href="#" className="block text-gray-400 hover:text-white transition-colors">Discord</a>
              <a href={`https://bscscan.com/token/${CONTRACTS.ETIMToken}`} target="_blank" rel="noopener noreferrer" className="block text-gray-400 hover:text-white transition-colors">BscScan</a>
            </div>
          </div>
        </div>
        <div className="mt-8 pt-8 border-t border-gray-800 text-center text-gray-500 text-sm">
          &copy; {new Date().getFullYear()} ETIM — Eternal Imprint. {t('footer.rights')}
        </div>
      </div>
    </footer>
  );
}
