import { useImageGallery } from "./useImageGallery";
import ImageGalleryLayout from "./ImageGallery.layout";

export default function ImageGallery(){

  const gallery = useImageGallery();

  return (
    <ImageGalleryLayout
      {...gallery}
    />
  );
}