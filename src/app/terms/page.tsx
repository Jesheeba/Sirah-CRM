import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Sirah CRM",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white px-6 py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-2 text-3xl font-bold text-slate-900">Terms of Service</h1>
        <p className="mb-8 text-sm text-slate-500">Last updated: 23 June 2026</p>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">1. Acceptance of terms</h2>
          <p className="text-slate-600 leading-relaxed">
            By accessing or using Sirah CRM (the &quot;Service&quot;), operated by{" "}
            <strong>Sirah Digital</strong>, you agree to be bound by these Terms of Service. If
            you do not agree, do not use the Service.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">2. Description of the Service</h2>
          <p className="text-slate-600 leading-relaxed">
            Sirah CRM is a cloud-based customer relationship management platform that provides
            tools for managing leads, contacts, deals, tasks, communications (including email
            and WhatsApp via the Meta WhatsApp Business Platform), quotations, and sales
            reporting for businesses and their teams.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">3. Eligibility and accounts</h2>
          <ul className="list-disc pl-5 space-y-2 text-slate-600 leading-relaxed">
            <li>You must be at least 18 years old and authorised to enter into these Terms on behalf of your organisation.</li>
            <li>You are responsible for maintaining the confidentiality of your login credentials and for all activity under your account.</li>
            <li>You must notify us immediately of any unauthorised use of your account at{" "}
              <a href="mailto:sirahdigitalemp@gmail.com" className="text-blue-600 underline">
                sirahdigitalemp@gmail.com
              </a>.
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">4. Acceptable use</h2>
          <p className="mb-2 text-slate-600 leading-relaxed">You agree not to:</p>
          <ul className="list-disc pl-5 space-y-2 text-slate-600 leading-relaxed">
            <li>Use the Service to send unsolicited messages (spam) via WhatsApp or email.</li>
            <li>Violate any applicable law or regulation, including data protection and privacy laws.</li>
            <li>Attempt to gain unauthorised access to other tenants' data or to Sirah Digital's systems.</li>
            <li>Use the Service to store or transmit malicious code.</li>
            <li>Reverse-engineer, decompile, or otherwise attempt to derive the source code of the platform.</li>
            <li>
              Use the WhatsApp integration in violation of Meta&apos;s{" "}
              <a
                href="https://www.whatsapp.com/legal/business-policy/"
                className="text-blue-600 underline"
                target="_blank"
                rel="noreferrer"
              >
                WhatsApp Business Policy
              </a>{" "}
              or{" "}
              <a
                href="https://developers.facebook.com/terms/"
                className="text-blue-600 underline"
                target="_blank"
                rel="noreferrer"
              >
                Meta Platform Terms
              </a>
              .
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">5. WhatsApp Business Platform</h2>
          <p className="text-slate-600 leading-relaxed">
            The Service integrates with the Meta WhatsApp Business Platform. By enabling
            WhatsApp features, you agree to comply with Meta&apos;s WhatsApp Business Policy and
            all applicable terms. You are solely responsible for ensuring that your WhatsApp
            communications comply with applicable law and that you have obtained any required
            consent from message recipients. Sirah Digital acts as a technology provider and
            is not responsible for the content of messages you send through the platform.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">6. Data and privacy</h2>
          <p className="text-slate-600 leading-relaxed">
            Your use of the Service is also governed by our{" "}
            <a href="/privacy" className="text-blue-600 underline">
              Privacy Policy
            </a>
            , which is incorporated into these Terms by reference. You retain ownership of all
            data you upload or create within the platform. By using the Service, you grant Sirah
            Digital the right to process that data solely to provide the Service to you.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">7. Third-party integrations</h2>
          <p className="text-slate-600 leading-relaxed">
            The Service may integrate with third-party platforms including Meta (Facebook,
            Instagram, WhatsApp), email providers, and others. Your use of those platforms is
            subject to their own terms and policies. Sirah Digital is not responsible for the
            availability, accuracy, or content of third-party services.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">8. Intellectual property</h2>
          <p className="text-slate-600 leading-relaxed">
            The Sirah CRM platform, including its design, code, and branding, is the intellectual
            property of Sirah Digital. Nothing in these Terms transfers ownership of any
            intellectual property to you.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">9. Limitation of liability</h2>
          <p className="text-slate-600 leading-relaxed">
            To the maximum extent permitted by law, Sirah Digital shall not be liable for any
            indirect, incidental, special, consequential, or punitive damages arising from your
            use of the Service. Our total liability for any claim shall not exceed the amount you
            paid to us in the twelve months preceding the claim.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">10. Disclaimer of warranties</h2>
          <p className="text-slate-600 leading-relaxed">
            The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind,
            express or implied. We do not warrant that the Service will be uninterrupted, error-free,
            or free from viruses or other harmful components.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">11. Termination</h2>
          <p className="text-slate-600 leading-relaxed">
            Either party may terminate access to the Service at any time. Upon termination, your
            right to use the Service ceases immediately. We may retain data for up to 30 days
            after termination before permanent deletion, as described in our Privacy Policy.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">12. Changes to these Terms</h2>
          <p className="text-slate-600 leading-relaxed">
            We may update these Terms from time to time. The date at the top of this page reflects
            the most recent revision. Continued use of the Service after a change constitutes your
            acceptance of the updated Terms.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-slate-800">13. Governing law</h2>
          <p className="text-slate-600 leading-relaxed">
            These Terms are governed by the laws of India. Any disputes shall be subject to the
            exclusive jurisdiction of the courts of India.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-slate-800">14. Contact</h2>
          <p className="text-slate-600 leading-relaxed">
            For any questions about these Terms, contact Sirah Digital at{" "}
            <a href="mailto:sirahdigitalemp@gmail.com" className="text-blue-600 underline">
              sirahdigitalemp@gmail.com
            </a>
            .
          </p>
        </section>

        <p className="mt-12 text-xs text-slate-400">
          © 2026 Sirah Digital. All rights reserved.
        </p>
      </div>
    </div>
  );
}
