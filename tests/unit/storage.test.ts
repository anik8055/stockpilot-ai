import { describe, expect, it } from "vitest";
import { signS3Request } from "@/lib/storage";

// Reference signatures were produced with botocore's S3SigV4Auth (AWS's own Python SDK) for identical requests.
const base = {
  endpoint: "https://ref.supabase.co/storage/v1/s3",
  region: "ap-south-1",
  bucket: "sp-private",
  accessKey: "AKIDEXAMPLE",
  secretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  now: new Date("2026-10-30T10:00:00Z"),
};

describe("S3 SigV4 signing", () => {
  it("matches botocore for a PUT with special characters in the key", () => {
    const { signature, headers, url } = signS3Request({
      ...base, method: "PUT", key: "b1/invoices/a b(1)*.pdf", body: Buffer.from("hello"), contentType: "application/pdf",
    });
    expect(url.pathname).toBe("/storage/v1/s3/sp-private/b1/invoices/a%20b%281%29%2A.pdf");
    expect(headers.authorization).toContain("SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date");
    expect(signature).toBe("540d033535c965153c25a89dfb16273a19838d99646a0385590e65095dd09c12");
  });

  it("matches botocore for a paginated list request", () => {
    const { signature } = signS3Request({
      ...base, method: "GET", key: "", query: { "list-type": "2", prefix: "b1/", "continuation-token": "a+b=" },
    });
    expect(signature).toBe("0482a59f32fd6cbc3fe3c51a2c2118ccb024266353420101fb504d9660041cef");
  });
});
