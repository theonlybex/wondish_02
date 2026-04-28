import PublicDishTinder from "@/components/taste/PublicDishTinder";

export const metadata = { title: "Try Dish Tinder — Wondish" };

export default function PublicTastePage() {
  return (
    <div className="min-h-screen bg-[#F8F7FA] pt-24 pb-16 px-5 sm:px-8">
      <PublicDishTinder />
    </div>
  );
}
