'use client';

import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { useEffect } from 'react';
import { useTranslation } from '@/lib/i18n';

export function ConnectButton({ label }: { label?: string }) {
  const { address, isConnected, isReconnecting } = useAccount();
  const { connect, connectors, isPending, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { t } = useTranslation();

  useEffect(() => {
    if (error) {
      reset();
    }
  }, [error, reset]);

  if (isReconnecting) {
    return (
      <button disabled className="bg-indigo-800 text-white px-6 py-2.5 rounded-xl font-semibold text-sm opacity-60">
        {t('connect.loading')}
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-300 font-mono bg-gray-800 px-3 py-2 rounded-lg">
          {address.slice(0, 6)}...{address.slice(-4)}
        </span>
        <button
          onClick={() => disconnect()}
          className="text-sm text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors"
        >
          {t('connect.disconnect')}
        </button>
      </div>
    );
  }

  const handleConnect = () => {
    const connector = connectors[0];
    if (connector) {
      connect({ connector });
    }
  };

  return (
    <button
      onClick={handleConnect}
      disabled={isPending}
      className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white px-6 py-2.5 rounded-xl font-semibold transition-colors text-sm"
    >
      {isPending ? t('connect.connecting') : label ?? t('connect.wallet')}
    </button>
  );
}
