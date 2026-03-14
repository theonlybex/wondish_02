import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const account = await prisma.account.findUnique({
          where: { email: credentials.email },
          include: { subscription: true, roles: { include: { role: true } } },
        });

        if (!account || !account.isEnabled) return null;

        const passwordValid = await bcrypt.compare(
          credentials.password,
          account.password
        );
        if (!passwordValid) return null;

        return {
          id: account.id,
          email: account.email,
          name: `${account.firstName} ${account.lastName}`,
          plan: account.subscription?.plan ?? "FREE",
          onboardingComplete: account.onboardingComplete,
          roles: account.roles.map((r) => r.role.name),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.plan = (user as { plan?: string }).plan ?? "FREE";
        token.onboardingComplete = (user as { onboardingComplete?: boolean }).onboardingComplete ?? false;
        token.roles = (user as { roles?: string[] }).roles ?? [];
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.plan = token.plan as string;
        session.user.onboardingComplete = token.onboardingComplete as boolean;
        session.user.roles = token.roles as string[];
      }
      return session;
    },
  },
};

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      plan: string;
      onboardingComplete: boolean;
      roles: string[];
    };
  }
}
