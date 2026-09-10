import type { NextAuthConfig } from "next-auth";

export const authConfig = {
    pages: {
        signIn: "/login",
    },
    callbacks: {
        authorized({ auth, request: { nextUrl } }) {
            const isLoggedIn = !!auth?.user;
            const isOnLogin = nextUrl.pathname.startsWith("/login");

            if (isOnLogin) {
                if (isLoggedIn) return Response.redirect(new URL("/", nextUrl));
                return true;
            }

            // semua route lain wajib login
            return isLoggedIn;
        },
        async jwt({ token, user }) {
            // 'user' cuma ada sekali, pas initial sign-in (dari return authorize()).
            // Setelah itu, token yang sudah di-encode ini yang dipakai terus tiap request.
            if (user) {
                token.id = user.id;
                token.role = (user as { role?: string }).role;
            }
            return token;
        },
        async session({ session, token }) {
            if (token.id) session.user.id = token.id as string;
            if (token.role) session.user.role = token.role as string;
            return session;
        },
    },
    providers: [], // provider asli (Credentials) diisi di auth.ts, bukan di sini
} satisfies NextAuthConfig;