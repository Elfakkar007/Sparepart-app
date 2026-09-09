"use server";

import { redirect } from "next/navigation";
// Sesuaikan path import ini kalau project Anda punya alias "@/*" -> "src/*",
// bisa diganti jadi: import { signIn } from "@/auth";
import { signIn } from "../../auth";

export type LoginFormState = {
    error?: string;
};

export async function loginAction(
    _prevState: LoginFormState,
    formData: FormData,
): Promise<LoginFormState> {
    const username = formData.get("username");
    const password = formData.get("password");

    // Validasi input dasar di sisi server sebelum memanggil signIn.
    if (
        typeof username !== "string" ||
        typeof password !== "string" ||
        username.trim() === "" ||
        password === ""
    ) {
        return { error: "Username atau password salah." };
    }

    try {
        await signIn("credentials", {
            username,
            password,
            redirect: false,
        });
    } catch {
        // signIn akan melempar error kalau kredensial salah (user tidak ada
        // atau password salah). Pesan sengaja dibuat generik demi keamanan,
        // tidak membedakan "user tidak ada" vs "password salah".
        return { error: "Username atau password salah." };
    }

    // Kalau tidak ada error yang dilempar, berarti login berhasil.
    redirect("/");
}