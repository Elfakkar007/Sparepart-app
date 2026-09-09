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
    },
    providers: [], // provider asli (Credentials) diisi di auth.ts, bukan di sini
} satisfies NextAuthConfig;