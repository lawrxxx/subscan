import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

const PUBLIC = ["/login", "/signup", "/reset", "/auth", "/welcome"];

export async function middleware(req: NextRequest) {
  // Guest (device-only) mode when Supabase isn't configured.
  if (!URL_ || !KEY) return NextResponse.next();

  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(URL_, KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(`${p}/`));
  if (!user && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  if (user && (path === "/login" || path === "/signup")) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  // Pages only: API routes authenticate themselves and return JSON errors.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|svg|css|js|woff2?)$).*)"],
};
