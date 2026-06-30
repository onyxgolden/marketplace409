export default function HomeMobileBottomNav() {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-2xl md:hidden z-50">
      <div className="grid grid-cols-5 text-center py-3">
        <button className="flex flex-col items-center text-blue-900 font-semibold">
          <span className="text-2xl">🏠</span>
          <span className="text-xs">Home</span>
        </button>

        <button className="flex flex-col items-center text-gray-600">
          <span className="text-2xl">🔍</span>
          <span className="text-xs">Browse</span>
        </button>

        <button className="flex flex-col items-center text-red-600 font-bold">
          <span className="text-3xl">➕</span>
          <span className="text-xs">Post</span>
        </button>

        <a href="/pets" className="flex flex-col items-center text-gray-600">
          <span className="text-2xl">🐶</span>
          <span className="text-xs">Pets</span>
        </a>

        <button className="flex flex-col items-center text-gray-600">
          <span className="text-2xl">👤</span>
          <span className="text-xs">Account</span>
        </button>
      </div>
    </div>
  );
}
