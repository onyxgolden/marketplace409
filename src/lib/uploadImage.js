import { supabase } from "@/lib/supabase";

export async function uploadImage({
  file,
  currentImageUrl = "",
  folder = "uploads",
  prefix = "image",
  recordId = "new",
}) {
  if (!file) {
    return currentImageUrl;
  }

  const fileExt = file.name.split(".").pop();
  const fileName = `${prefix}-${recordId}-${Date.now()}.${fileExt}`;
  const filePath = `${folder}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from("listing-images")
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) {
    console.log(uploadError);
    alert("Image upload failed.");
    return currentImageUrl;
  }

  const { data } = supabase.storage
    .from("listing-images")
    .getPublicUrl(filePath);

  return data.publicUrl;
}
