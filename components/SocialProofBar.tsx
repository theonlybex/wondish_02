import { getTranslations } from "next-intl/server";

const avatars = ["A", "M", "S", "J", "R"];
const avatarColors = ["bg-emerald-500", "bg-violet-500", "bg-sky-500", "bg-orange-500", "bg-pink-500"];

export default async function SocialProofBar() {
  const t = await getTranslations("socialProof");

  return (
    <div className="bg-[#0d1a10] border-b border-white/5 py-4 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-10">
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            {avatars.map((letter, i) => (
              <div key={i} className={`w-7 h-7 rounded-full ${avatarColors[i]} border-2 border-[#0d1a10] flex items-center justify-center text-white text-[10px] font-bold`}>
                {letter}
              </div>
            ))}
          </div>
          <span className="text-white/50 text-sm">
            {t("joinedBy")} <span className="text-white font-semibold">10,000+</span> {t("members")}
          </span>
        </div>
        <div className="hidden sm:block w-px h-5 bg-white/10" />
        <div className="flex items-center gap-2">
          <div className="flex text-yellow-400 text-sm">{"★★★★★"}</div>
          <span className="text-white/50 text-sm">
            <span className="text-white font-semibold">4.9/5</span> {t("rating")}
          </span>
        </div>
        <div className="hidden sm:block w-px h-5 bg-white/10" />
        <div className="flex items-center gap-5 text-sm text-white/40">
          <span><span className="text-white/70 font-medium">500+</span> {t("recipes")}</span>
          <span>·</span>
          <span><span className="text-white/70 font-medium">{t("freeTier")}</span></span>
        </div>
      </div>
    </div>
  );
}
