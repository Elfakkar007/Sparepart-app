import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Simpan instance PrismaClient di object global (khusus saat development)
// supaya hot-reload Next.js tidak terus membuat instance baru,
// yang bisa menghabiskan koneksi ke database.
const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error("Environment variable DATABASE_URL belum diset");
}

// Generator "prisma-client" di Prisma 7 sudah tidak pakai Rust query engine
// bawaan, jadi wajib pasang driver adapter secara eksplisit.
// Untuk PostgreSQL pakai node-postgres lewat @prisma/adapter-pg.
const adapter = new PrismaPg({ connectionString: databaseUrl });

// Aktifkan log query saat development kalau perlu debugging, contoh:
// new PrismaClient({ adapter, log: ["query", "error", "warn"] })
export const prisma: PrismaClient =
    globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
}

export default prisma;