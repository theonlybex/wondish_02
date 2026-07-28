import { Inter } from "next/font/google";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import RevealObserver from "@/components/RevealObserver";

const inter = Inter({ subsets: ["latin", "latin-ext", "cyrillic"] });

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${inter.className} bg-[#FFFDF5] text-[#1E1A1A]`}>
      <style>{`
        .reveal { opacity: 0; transform: translateY(34px); transition: opacity .8s cubic-bezier(.22,1,.36,1), transform .8s cubic-bezier(.22,1,.36,1); }
        .reveal.in { opacity: 1; transform: none; }
        .d1 { transition-delay: .08s } .d2 { transition-delay: .16s } .d3 { transition-delay: .24s } .d4 { transition-delay: .32s }
      `}</style>
      <RevealObserver />
      <Navbar />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
