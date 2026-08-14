import Link from 'next/link';

const primaryLinkClasses =
  'rounded px-4 py-2 font-medium focus-visible:outline focus-visible:outline-2 bg-primary text-white hover:bg-primary-hover';
const secondaryLinkClasses =
  'rounded px-4 py-2 font-medium focus-visible:outline focus-visible:outline-2 bg-surface border border-border text-text-primary hover:bg-surface-alt';

export default function Home() {
  return (
    <main id="main-content" className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold">Emplement</h1>
      <p className="mt-2 mb-8 text-text-secondary">
        Unemployment benefit claims — claimant and caseworker portals.
      </p>

      <div className="grid gap-6 sm:grid-cols-2">
        <section className="border border-border rounded p-4">
          <h2 className="font-medium mb-1">Claimants</h2>
          <p className="text-sm text-text-secondary mb-4">
            File a new claim, certify your weekly benefits, or check your claim status.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/claim/login" className={primaryLinkClasses}>
              Log in
            </Link>
            <Link href="/claim/signup" className={secondaryLinkClasses}>
              Create an account
            </Link>
          </div>
        </section>

        <section className="border border-border rounded p-4">
          <h2 className="font-medium mb-1">Caseworkers</h2>
          <p className="text-sm text-text-secondary mb-4">
            Review flagged certifications, manage claimant cases, and respond to messages.
          </p>
          <Link href="/staff/login" className={secondaryLinkClasses}>
            Staff log in
          </Link>
        </section>
      </div>
    </main>
  );
}
