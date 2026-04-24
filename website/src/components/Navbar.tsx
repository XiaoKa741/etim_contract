'use client';

import Link from 'next/link';
import { ConnectButton } from '@/components/ConnectButton';
import { useTranslation, LOCALES, type Locale } from '@/lib/i18n';
import { useState, useRef, useEffect } from 'react';

function LanguageSwitcher() {
  const { locale, setLocale } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // UK flag SVG - works on all platforms including Windows
  const UkFlag = () => (
    <svg className="w-4 h-4 rounded-sm" viewBox="0 0 60 30" fill="none">
      <clipPath id="s">
        <path d="M0,0 v30 h60 v-30 z"/>
      </clipPath>
      <clipPath id="t">
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/>
      </clipPath>
      <g clipPath="url(#s)">
        <path d="M0,0 v30 h60 v-30 z" fill="#012169"/>
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6"/>
        <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#t)" stroke="#C8102E" strokeWidth="4"/>
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10"/>
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6"/>
      </g>
    </svg>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors"
      >
        {current.code === 'en' && <UkFlag />}
        <span>{current.label}</span>
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-40 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden z-50">
          {LOCALES.map((l) => (
            <button
              key={l.code}
              onClick={() => { setLocale(l.code); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-gray-700 transition-colors ${
                l.code === locale ? 'text-indigo-400 bg-gray-700/50' : 'text-gray-300'
              }`}
            >
              {l.code === 'en' && <UkFlag />}
              <span>{l.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { t } = useTranslation();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-gray-900/95 sm:bg-gray-900/80 sm:backdrop-blur-md border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <img
              src="/icon.png"
              alt="ETIM"
              className="w-8 h-8 rounded-lg object-cover"
            />
            <span className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
              ETIM
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-4">
            <Link href="/" className="text-gray-300 hover:text-white transition-colors text-sm">
              {t('nav.home')}
            </Link>
            <Link href="/swap" className="text-gray-300 hover:text-white transition-colors text-sm">
              {t('nav.swap')}
            </Link>
            <Link href="/dashboard" className="text-gray-300 hover:text-white transition-colors text-sm">
              {t('nav.dashboard')}
            </Link>
            <Link href="/whitepaper" className="text-gray-300 hover:text-white transition-colors text-sm">
              {t('nav.whitepaper')}
            </Link>
            <Link href="/gallery" className="text-gray-300 hover:text-white transition-colors text-sm">
              {t('nav.gallery')}
            </Link>
            <LanguageSwitcher />
            <ConnectButton />
          </div>

          <button
            className="md:hidden text-gray-300 hover:text-white"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden bg-gray-900/95 border-b border-gray-800 px-4 pb-4">
          <div className="flex flex-col gap-3">
            <Link href="/" className="text-gray-300 hover:text-white py-2" onClick={() => setMobileOpen(false)}>
              {t('nav.home')}
            </Link>
            <Link href="/swap" className="text-gray-300 hover:text-white py-2" onClick={() => setMobileOpen(false)}>
              {t('nav.swap')}
            </Link>
            <Link href="/dashboard" className="text-gray-300 hover:text-white py-2" onClick={() => setMobileOpen(false)}>
              {t('nav.dashboard')}
            </Link>
            <Link href="/whitepaper" className="text-gray-300 hover:text-white py-2" onClick={() => setMobileOpen(false)}>
              {t('nav.whitepaper')}
            </Link>
            <Link href="/gallery" className="text-gray-300 hover:text-white py-2" onClick={() => setMobileOpen(false)}>
              {t('nav.gallery')}
            </Link>
            <div className="flex items-center gap-3 pt-2">
              <LanguageSwitcher />
              <ConnectButton />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
