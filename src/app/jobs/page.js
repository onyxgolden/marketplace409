import DeleteJobButton from "@/components/DeleteJobButton";
import Header from "@/components/Header";
import ShareButton from "@/components/ShareButton";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-6xl mx-auto py-12 px-6">
        <h1 className="text-5xl font-extrabold mb-4">409 Jobs</h1>

        <p className="text-xl text-gray-600 mb-8">
          Local hiring board for Southeast Texas jobs, side work, trades, and
          small businesses.
        </p>

        <a
          href="/jobs/add"
          className="inline-block bg-red-600 text-white px-6 py-3 rounded-xl font-bold mb-8 hover:bg-red-500"
        >
          Post a Job
        </a>

        {error && (
          <div className="bg-red-100 text-red-700 p-4 rounded-xl mb-6">
            Could not load jobs.
          </div>
        )}

        {!jobs || jobs.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-md p-8 text-center">
            <h2 className="text-2xl font-bold mb-2">No jobs posted yet</h2>
            <p className="text-gray-600">
              Be the first to post a local job or hiring opportunity.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="bg-white rounded-2xl shadow-md overflow-hidden"
              >
                <div className="p-5">
                  <p className="text-sm text-gray-500">{job.city}</p>

                  <h2 className="text-2xl font-bold mt-1">{job.job_title}</h2>

                  <p className="text-lg font-bold text-blue-900 mt-2">
                    {job.company_name}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {job.category && (
                      <span className="bg-blue-100 text-blue-900 px-3 py-1 rounded-full text-sm font-bold">
                        {job.category}
                      </span>
                    )}

                    {job.employment_type && (
                      <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-bold">
                        {job.employment_type}
                      </span>
                    )}

                    {job.pay_range && (
                      <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-sm font-bold">
                        {job.pay_range}
                      </span>
                    )}
                  </div>

                  <div className="mt-4 text-gray-600 max-h-40 overflow-y-auto pr-2">
                    {job.description}
                  </div>

                  {job.requirements && (
                    <div className="mt-4 text-gray-600 max-h-32 overflow-y-auto pr-2">
                      <p className="font-bold text-gray-900 mb-1">
                        Requirements:
                      </p>
                      {job.requirements}
                    </div>
                  )}

                  {job.contact_phone && (
                    <a
                      href={`tel:${job.contact_phone}`}
                      className="block mt-4 bg-green-700 text-white text-center py-3 rounded-xl font-bold"
                    >
                      Call Employer
                    </a>
                  )}

                  {job.contact_phone && (
                    <a
                      href={`sms:${job.contact_phone}`}
                      className="block mt-3 bg-blue-900 text-white text-center py-3 rounded-xl font-bold"
                    >
                      Text Employer
                    </a>
                  )}

                  {job.contact_email && (
                    <a
                      href={`mailto:${job.contact_email}?subject=${encodeURIComponent(
                        `Job Interest: ${job.job_title}`,
                      )}`}
                      className="block mt-3 bg-gray-800 text-white text-center py-3 rounded-xl font-bold"
                    >
                      Email Employer
                    </a>
                  )}

                  {job.apply_url && (
                    <a
                      href={job.apply_url}
                      target="_blank"
                      className="block mt-3 bg-purple-700 text-white text-center py-3 rounded-xl font-bold"
                    >
                      Apply Online
                    </a>
                  )}

                  <a
                    href={`/jobs/edit/${job.id}`}
                    className="block mt-4 bg-blue-700 text-white text-center py-3 rounded-xl font-bold hover:bg-blue-600"
                  >
                    Edit Job
                  </a>

                  <DeleteJobButton jobId={job.id} />
                  <ShareButton
                    title={`${job.job_title} at ${job.company_name}`}
                    url="https://409marketplace.online/jobs"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
