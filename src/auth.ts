import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { authConfig } from "./auth.config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export const { handlers, signIn, signOut, auth } = NextAuth({
    ...authConfig,
    providers: [
        Credentials({
            credentials: {
                username: {},
                password: {},
            },
            async authorize(credentials) {
                if (!credentials?.username || !credentials?.password) {
                    return null;
                }

                const user = await prisma.user.findUnique({
                    where: { username: credentials.username as string },
                });

                if (!user) return null;

                const passwordCocok = await bcrypt.compare(
                    credentials.password as string,
                    user.passwordHash
                );

                if (!passwordCocok) return null;

                // ini yang disimpan ke session
                return {
                    id: user.id,
                    name: user.username,
                    role: user.role,
                };
            },
        }),
    ],
});