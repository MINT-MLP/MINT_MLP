export default function LandingPhoneMockup({ src, alt, width = 'w-56' }: { src: string; alt: string; width?: string }) {
  return (
    <div className={`${width} mx-auto rounded-[2rem] bg-white p-1.5 ring-1 ring-black/5 shadow-2xl shadow-mint-900/10`}>
      <div className="overflow-hidden rounded-[1.6rem] bg-white">
        <img src={src} alt={alt} className="w-full block" loading="lazy" />
      </div>
    </div>
  );
}
