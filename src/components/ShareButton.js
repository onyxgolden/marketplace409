"use client";

export default function ShareButton({ title, url }) {
  const shareText = `Check this out on 409 Marketplace: ${title}`;
  const encodedText = encodeURIComponent(shareText);
  const encodedUrl = encodeURIComponent(url);

  async function copyLink() {
    await navigator.clipboard.writeText(url);
    alert("Link copied!");
  }

  return (
    <div className="mt-3 grid grid-cols-1 gap-3">
      <a
        href={`sms:?&body=${encodedText}%20${encodedUrl}`}
        className="block text-center bg-green-700 text-white py-3 rounded-xl font-bold hover:bg-green-600"
      >
        Share by Text
      </a>

      <a
        href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodedText}%0A%0A${encodedUrl}`}
        className="block text-center bg-gray-800 text-white py-3 rounded-xl font-bold hover:bg-gray-700"
      >
        Share by Email
      </a>

      <a
        href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
        target="_blank"
        className="block text-center bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-500"
      >
        Share on Facebook
      </a>

      <button
        onClick={copyLink}
        className="w-full bg-purple-700 text-white py-3 rounded-xl font-bold hover:bg-purple-600"
      >
        Copy Link
      </button>
    </div>
  );
}