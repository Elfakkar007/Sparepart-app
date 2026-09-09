import { Role } from "../generated/prisma/client";
import { DefaultSession } from "next-auth";

declare module "next-auth" {
    interface User {
        role: Role;
    }

    interface Session {
        user: {
            role: Role;
        } & DefaultSession["user"];
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        role: Role;
    }
}