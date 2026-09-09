// Script ini HANYA dijalankan manual lewat terminal (npm run seed:admin),
// bukan bagian dari alur aplikasi. Tidak ada kredensial yang di-hardcode
// di sini — username & password admin WAJIB diisi lewat environment
// variable saat menjalankan command (lihat instruksi penggunaan).

import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaClient, Role } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const SALT_ROUNDS = 10;

async function main() {
    const username = process.env.SEED_ADMIN_USERNAME;
    const password = process.env.SEED_ADMIN_PASSWORD;

    if (!username || !password) {
        throw new Error(
            "SEED_ADMIN_USERNAME dan SEED_ADMIN_PASSWORD wajib di-set sebagai " +
            "environment variable sebelum menjalankan script ini.",
        );
    }

    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    const prisma = new PrismaClient({ adapter });

    try {
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        // upsert: kalau username sudah ada, passwordHash & role-nya di-update.
        // Kalau belum ada, dibuat baru. Aman dijalankan berkali-kali.
        const user = await prisma.user.upsert({
            where: { username },
            update: {
                passwordHash,
                role: Role.SUPER_ADMIN,
            },
            create: {
                username,
                passwordHash,
                role: Role.SUPER_ADMIN,
            },
        });

        console.log(`Seed berhasil. User admin "${user.username}" siap dipakai untuk login.`);
    } catch (error) {
        console.error("Terjadi error saat proses seeding:", error);
        process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    // Menangani error yang terjadi sebelum masuk try (mis. env var belum di-set).
    console.error("Seed gagal:", error);
    process.exitCode = 1;
});