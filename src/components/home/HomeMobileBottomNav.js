import { Home, PawPrint, Plus, Search, UserRound } from "lucide-react";

export default function HomeMobileBottomNav() {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-2xl md:hidden z-50">
      <div className="grid grid-cols-5 text-center py-3">
        <button className="flex flex-col items-center text-slate-950 font-semibold">
          <Home aria-hidden="true" className="h-6 w-6" />
          <span className="text-xs">Home</span>
        </button>

        <button className="flex flex-col items-center text-slate-500">
          <Search aria-hidden="true" className="h-6 w-6" />
          <span className="text-xs">Browse</span>
        </button>

        <button className="flex flex-col items-center text-amber-500 font-bold">
          <Plus aria-hidden="true" className="h-7 w-7" />
          <span className="text-xs">Post</span>
        </button>

        <a href="/pets" className="flex flex-col items-center text-slate-500">
          <PawPrint aria-hidden="true" className="h-6 w-6" />
          <span className="text-xs">Pets</span>
        </a>

        <button className="flex flex-col items-center text-slate-500">
          <UserRound aria-hidden="true" className="h-6 w-6" />
          <span className="text-xs">Account</span>
        </button>
      </div>
    </div>
  );
}
