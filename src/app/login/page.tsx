import LoginForm from "./login-form";

export default function LoginPage() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
            <div className="w-full max-w-[400px] space-y-6 rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
                <div className="space-y-1 text-center">
                    <h1 className="text-2xl font-semibold text-gray-900">Masuk</h1>
                    <p className="text-sm text-gray-500">
                        Silakan masuk menggunakan akun Anda.
                    </p>
                </div>

                <LoginForm />
            </div>
        </main>
    );
}