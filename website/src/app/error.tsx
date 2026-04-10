'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#0a0a1a] flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <h2 className="text-xl font-bold text-white mb-4">Something went wrong</h2>
        <p className="text-gray-400 mb-6 text-sm break-all">
          {error?.message || 'An unexpected error occurred'}
        </p>
        <button
          onClick={reset}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
