
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Allow": "POST" },
      body: "Method not allowed"
    };
  }

  const apiKey = process.env.PHOTOROOM_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Background removal is not configured."
      })
    };
  }

  try {
    const contentType = event.headers["content-type"] || "";

    if (!contentType.includes("multipart/form-data")) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Please upload an image."
        })
      };
    }

    const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.slice(1).find(Boolean);

    if (!boundary || !event.isBase64Encoded) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Invalid image upload."
        })
      };
    }

    const raw = Buffer.from(event.body || "", "base64");
    const marker = Buffer.from("\r\n\r\n");
    const separator = Buffer.from("--" + boundary);
    const parts = [];

    let pos = 0;
    while (pos < raw.length) {
      const start = raw.indexOf(separator, pos);
      if (start < 0) break;

      let headerStart = start + separator.length;
      if (raw.subarray(headerStart, headerStart + 2).toString() === "--") break;
      if (raw.subarray(headerStart, headerStart + 2).toString() === "\r\n") headerStart += 2;

      const headerEnd = raw.indexOf(marker, headerStart);
      if (headerEnd < 0) break;

      const headers = raw.subarray(headerStart, headerEnd).toString("utf8");
      const dataStart = headerEnd + marker.length;
      const next = raw.indexOf(Buffer.concat([
        Buffer.from("\r\n"), separator
      ]), dataStart);

      if (next < 0) break;

      if (/name="image_file"/i.test(headers)) {
        parts.push({
          headers,
          data: raw.subarray(dataStart, next)
        });
      }
      pos = next + 2;
    }

    if (!parts.length || !parts[0].data.length) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "No image file was received."
        })
      };
    }

    const image = parts[0].data;
    if (image.length > 10 * 1024 * 1024) {
      return {
        statusCode: 413,
        body: JSON.stringify({
          error: "Image is too large. Please use an image under 10 MB."
        })
      };
    }

    const upload = new FormData();
    upload.append(
      "image_file",
      new Blob([image]),
      "upload.jpg"
    );

    const response = await fetch(
      "https://sdk.photoroom.com/v1/segment",
      {
        method: "POST",
        headers: { "x-api-key": apiKey },
        body: upload
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error("Photoroom API error:", response.status, detail);

      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Background removal failed. Please try again."
        })
      };
    }

    const result = Buffer.from(await response.arrayBuffer());

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store"
      },
      body: result.toString("base64")
    };
  } catch (error) {
    console.error("Background removal error:", error);

    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Something went wrong while processing the image."
      })
    };
  }
};
