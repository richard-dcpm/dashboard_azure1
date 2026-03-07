import "./uploader.css";
import UploaderLayout from "./Uploader.layout";
import { useUploader } from "./useUploader";

export default function Uploader() {
  const uploader = useUploader();

  return (
    <UploaderLayout
      containers={uploader.containers}
      navigateToDashboard={uploader.goHome}
      listFolders={uploader.listFolders}
      createFolderApi={uploader.createFolderApi}
      renameFolderApi={uploader.renameFolderApi}
      hideFolderApi={uploader.hideFolderApi}
      enqueueFiles={uploader.enqueueFiles}
      queue={uploader.queue}
      globalProgress={uploader.globalProgress}
      retryItem={uploader.retryItem}
      cancelItem={uploader.cancelItem}
    />
  );
}