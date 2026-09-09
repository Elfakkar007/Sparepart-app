"use client";

import { useActionState } from "react";
import { loginAction, type LoginFormState } from "./actions";

const initialState: LoginFormState = {};

export default function LoginForm() {
    const [state, formAction, isPending] = useActionState(
        loginAction,
        initialState,
    );

    return (
        <form action={formAction} className="space-y-4">
            {state.error && (
                <p
                    role="alert"
                    className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600"
                >
                    {state.error}
                </p>
            )}

            <div className="space-y-1">
                <label
                    htmlFor="username"
                    className="block text-sm font-medium text-gray-700"
                >
                    Username
                </label>
                <input
                    id="username"
                    name="username"
                    type="text"
                    required
                    autoComplete="username"
                    disabled={isPending}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-100"
                />
            </div>

            <div className="space-y-1">
                <label
                    htmlFor="password"
                    className="block text-sm font-medium text-gray-700"
                >
                    Password
                </label>
                <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    disabled={isPending}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-100"
                />
            </div>

            <button
                type="submit"
                disabled={isPending}
                className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
                {isPending ? "Memproses..." : "Masuk"}
            </button>
        </form>
    );
}