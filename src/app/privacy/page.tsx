import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Sirah CRM",
};

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white px-6 py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-2 text-3xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="mb-8 text-sm text-slate-500">Last updated: June 2025</p>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">1. Who we are</h2>
          <p className="text-slate-600 leading-relaxed">
            Sirah CRM is a cloud-based customer relationship management platform operated by
            Sirah Digital. We help businesses manage leads, contacts, deals, and customer
            communication in one place.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">2. What data we collect</h2>
          <ul className="list-disc pl-5 space-y-2 text-slate-600 leading-relaxed">
            <li>
              <strong>Account information:</strong> name, email address, and password when you
              sign up.
            </li>
            <li>
              <strong>CRM data:</strong> leads, contacts, deals, notes, tasks, and activities that
              you create inside the platform.
            </li>
            <li>
              <strong>Meta / Facebook Lead Ads data:</strong> when you connect a Facebook Page,
              we receive the Page ID and a Page Access Token from Meta. When a lead submits
              your instant form, we receive the lead&apos;s name, email, phone number, and any
              answers they provided. This data is stored in our database and used solely to
              populate your CRM records.
            </li>
            <li>
              <strong>Usage data:</strong> IP address, browser type, and pages visited, collected
              automatically for security and performance.
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">3. How we use your data</h2>
          <ul className="list-disc pl-5 space-y-2 text-slate-600 leading-relaxed">
            <li>To provide and operate the CRM service.</li>
            <li>To import leads from connected advertising platforms (Facebook/Instagram Lead Ads).</li>
            <li>To send transactional emails and notifications related to your account.</li>
            <li>To improve the platform and diagnose technical issues.</li>
          </ul>
          <p className="mt-3 text-slate-600 leading-relaxed">
            We do <strong>not</strong> sell, rent, or share your data with third parties for
            marketing purposes.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">4. Facebook / Meta integration</h2>
          <p className="text-slate-600 leading-relaxed">
            When you use the &quot;Connect Facebook&quot; feature, you authorise Sirah CRM to access your
            Facebook Pages using the following permissions:
          </p>
          <ul className="mt-2 list-disc pl-5 space-y-1 text-slate-600">
            <li><code className="text-sm bg-slate-100 px-1 rounded">pages_show_list</code> — list Pages you manage</li>
            <li><code className="text-sm bg-slate-100 px-1 rounded">pages_manage_metadata</code> — subscribe Pages to lead webhooks</li>
            <li><code className="text-sm bg-slate-100 px-1 rounded">leads_retrieval</code> — read lead form submissions</li>
            <li><code className="text-sm bg-slate-100 px-1 rounded">pages_read_engagement</code> — read basic Page info</li>
            <li><code className="text-sm bg-slate-100 px-1 rounded">pages_manage_ads</code> — subscribe to ad lead events</li>
            <li><code className="text-sm bg-slate-100 px-1 rounded">business_management</code> — list Business-managed Pages</li>
          </ul>
          <p className="mt-3 text-slate-600 leading-relaxed">
            Page Access Tokens are stored securely and used only to retrieve leads on your behalf.
            You can disconnect any Page at any time from Settings → Integrations, which immediately
            revokes our access.
          </p>
          <p className="mt-3 text-slate-600 leading-relaxed">
            Our use of data received from Facebook APIs complies with
            the <a href="https://developers.facebook.com/terms/" className="text-blue-600 underline" target="_blank" rel="noreferrer">Meta Platform Terms</a>.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">5. Data storage and security</h2>
          <p className="text-slate-600 leading-relaxed">
            All data is stored in Supabase (PostgreSQL), hosted on AWS infrastructure. Data is
            encrypted at rest and in transit (TLS). Access tokens are stored in columns that are
            not accessible to the browser client — only server-side code can read them.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">6. Data retention</h2>
          <p className="text-slate-600 leading-relaxed">
            CRM data is retained for as long as your account is active. If you delete your
            account, all associated data is permanently deleted within 30 days. Lead data
            received from Facebook is subject to your Facebook Page&apos;s own data retention
            settings.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">7. Your rights</h2>
          <p className="text-slate-600 leading-relaxed">
            You may request access to, correction of, or deletion of your personal data at any
            time by contacting us. You may also export your CRM data from within the platform.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">8. Contact</h2>
          <p className="text-slate-600 leading-relaxed">
            For privacy questions or data requests, contact us at:{" "}
            <a href="mailto:sirahdigitalemp@gmail.com" className="text-blue-600 underline">
              sirahdigitalemp@gmail.com
            </a>
          </p>
        </section>

        <p className="mt-12 text-xs text-slate-400">
          © 2025 Sirah Digital. All rights reserved.
        </p>
      </div>
    </div>
  );
}
