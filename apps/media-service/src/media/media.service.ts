import { Injectable } from "@nestjs/common";
import ImageKit from "imagekit";

@Injectable()
export class MediaService {
  private readonly imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY ?? "",
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY ?? "",
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT ?? "",
  });

  /**
   * Returns short-lived signed params for the browser to upload *directly*
   * to ImageKit (no file bytes ever touch our servers). Frontend uses these
   * with the `imagekitio-react`/`@imagekit/next` upload helper.
   */
  getUploadAuthParams() {
    const { token, expire, signature } = this.imagekit.getAuthenticationParameters();
    return {
      token,
      expire,
      signature,
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
      urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
    };
  }
}
