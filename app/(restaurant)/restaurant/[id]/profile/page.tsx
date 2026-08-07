import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getPortalPageContext } from "@/lib/restaurant-portal-page";
import PortalProfileForm from "@/components/restaurant/PortalProfileForm";

export async function generateMetadata({ params }: { params: { id: string } }) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: params.id } });
  return { title: restaurant ? `${restaurant.name} · Profile` : "Profile" };
}

// Phase 6a M4 — restaurant profile screen (design §5.5).
export default async function RestaurantProfilePage({ params }: { params: { id: string } }) {
  const gate = await getPortalPageContext(params.id);
  if (!gate.allowed) redirect(gate.redirectTo);

  const restaurant = await prisma.restaurant.findUnique({ where: { id: params.id } });
  if (!restaurant) notFound();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#1E1A1A]">Profile</h1>
        <p className="text-xs mt-1.5" style={{ color: "#848181" }}>
          What diners see about {restaurant.name} — address, hours, photos.
        </p>
      </div>

      <div className="bg-white border border-[#EAE4CA] rounded-2xl p-6 max-w-2xl">
        <PortalProfileForm
          initial={{
            id: restaurant.id,
            name: restaurant.name,
            description: restaurant.description,
            neighborhood: restaurant.neighborhood,
            addressLine: restaurant.addressLine,
            city: restaurant.city,
            state: restaurant.state,
            postalCode: restaurant.postalCode,
            phone: restaurant.phone,
            website: restaurant.website,
            hours: typeof restaurant.hours === "string" ? restaurant.hours : null,
            imageUrl: restaurant.imageUrl,
            logoUrl: restaurant.logoUrl,
          }}
        />
      </div>
    </div>
  );
}
