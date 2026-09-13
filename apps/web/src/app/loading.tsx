export default function Loading() {
  return (
    <main className="container-x flex flex-col gap-6 py-6" aria-busy>
      <div className="skeleton h-[420px] w-full rounded-[24px]" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-[260px] rounded-[20px]" />
        ))}
      </div>
    </main>
  );
}
