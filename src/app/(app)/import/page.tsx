import ImportWizard from "@/components/import/ImportWizard";

export const metadata = { title: "Data Import — Sirah CRM" };

export default function ImportPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Data Import</h1>
        <p className="text-sm text-slate-500">Upload a CSV to import leads, contacts, or deals.</p>
      </div>
      <ImportWizard />
    </div>
  );
}
