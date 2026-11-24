export default function Loading() {
  return (
    <div className="animate-pulse space-y-3" aria-busy="true" aria-label="Loading">
      <div className="h-10 w-64 rounded-xl bg-ink-900/8" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-24 rounded-2xl bg-ink-900/6" />)}
      </div>
      {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-24 rounded-2xl bg-ink-900/6" />)}
    </div>
  );
}
