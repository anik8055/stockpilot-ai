import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy & data" };

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-14 sm:px-6 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mt-1.5 [&_p]:mt-3 [&_p]:text-text/90 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
      <h1 className="text-3xl font-semibold">Privacy and your data</h1>
      <p className="text-muted">Plain-language summary of what StockPilot stores, why, and how to have it deleted.</p>

      <h2>What we store</h2>
      <ul>
        <li><strong>Account details:</strong> your name, email address and a one-way hash of your password (never the password itself).</li>
        <li><strong>Business data you import or enter:</strong> products, suppliers, stock counts, sales and purchase history, purchase orders, goods receipts and reports.</li>
        <li><strong>Uploaded files:</strong> spreadsheets you import and supplier invoices you upload, kept in private storage so you can download them again and so imports can be audited.</li>
        <li><strong>Activity records:</strong> an audit log of important actions (imports, stock changes, purchase orders) and counts of AI requests for plan limits.</li>
        <li><strong>Sign-in sessions:</strong> a session cookie and the browser type, so you stay signed in.</li>
        <li><strong>Demo requests:</strong> the details you type into the contact form.</li>
      </ul>

      <h2>Why we use it</h2>
      <p>Only to provide the service to you: calculating stock positions, recommendations and reports for your workspace, keeping you signed in, enforcing plan limits and replying to you. We do not sell your data and we do not use one customer&apos;s data for another customer.</p>

      <h2>AI features</h2>
      <p>When you use Ask StockPilot or invoice reading with an AI provider switched on, a small, filtered extract needed to answer the question — for example totals and the relevant product rows, or the text of the invoice you uploaded — is sent to that provider. Your whole database is never sent. The workspace owner can see whether AI is enabled in Settings.</p>

      <h2>Who can see your data</h2>
      <p>Only members of your workspace. Each workspace is isolated in the database, and every request is checked against your membership. Owners and administrators can add or remove members.</p>

      <h2>Deleting your data</h2>
      <ul>
        <li>An owner can delete a workspace and all of its data from Settings → Workspace → Delete workspace.</li>
        <li>You can delete your account from Settings → Account. Workspaces where you are the only owner are deleted with it.</li>
        <li>You can also email us to request deletion; we will confirm once it is done.</li>
      </ul>
      <p>Deleted data is removed from the live database and file storage immediately. Database backups kept by our hosting provider expire on their normal schedule.</p>

      <h2>Certifications</h2>
      <p>StockPilot does not currently hold any security or compliance certification. We will not claim one until it has been independently obtained.</p>
    </article>
  );
}
