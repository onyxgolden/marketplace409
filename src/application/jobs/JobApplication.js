const EMPTY_JOB_FORM = Object.freeze({
  jobTitle: "",
  companyName: "",
  category: "",
  city: "",
  employmentType: "",
  payRange: "",
  description: "",
  requirements: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  applyUrl: "",
  communityJobPosting: false,
});

function buildJobForm(row = {}) {
  return {
    jobTitle: row.job_title || "",
    companyName: row.company_name || "",
    category: row.category || "",
    city: row.city || "",
    employmentType: row.employment_type || "",
    payRange: row.pay_range || "",
    description: row.description || "",
    requirements: row.requirements || "",
    contactName: row.contact_name || "",
    contactPhone: row.contact_phone || "",
    contactEmail: row.contact_email || "",
    applyUrl: row.apply_url || "",
    communityJobPosting: row.community_job_posting || false,
  };
}

function buildJobPayload(form) {
  return {
    job_title: form.jobTitle,
    company_name: form.companyName,
    category: form.category,
    city: form.city,
    employment_type: form.employmentType,
    pay_range: form.payRange,
    description: form.description,
    requirements: form.requirements,
    contact_name: form.contactName,
    contact_phone: form.contactPhone,
    contact_email: form.contactEmail,
    apply_url: form.applyUrl,
    community_job_posting: form.communityJobPosting,
  };
}

export class JobApplication {
  constructor({ supabase } = {}) {
    this.supabase = supabase;
  }

  getInitialJobForm() {
    return { ...EMPTY_JOB_FORM };
  }

  async createJob(form) {
    const {
      data: { user },
    } = await this.supabase.auth.getUser();

    if (!user) {
      return {
        ok: false,
        redirectTo: "/auth",
        message: "Please create a free account before posting a job.",
        requiresAuthentication: true,
      };
    }

    const { error } = await this.supabase
      .from("jobs")
      .insert([buildJobPayload(form)]);

    if (error) {
      return {
        ok: false,
        message: error.message || "Error posting job",
        error,
      };
    }

    return {
      ok: true,
      redirectTo: "/jobs",
      message: "Job posted!",
    };
  }

  async loadJob(jobId) {
    const { data, error } = await this.supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (error || !data) {
      return {
        ok: false,
        redirectTo: "/jobs",
        message: "Job not found",
        error,
      };
    }

    return {
      ok: true,
      form: buildJobForm(data),
    };
  }

  async updateJob({ jobId, form }) {
    const { error } = await this.supabase
      .from("jobs")
      .update(buildJobPayload(form))
      .eq("id", jobId);

    if (error) {
      return {
        ok: false,
        message: error.message || "Error updating job",
        error,
      };
    }

    return {
      ok: true,
      redirectTo: "/jobs",
      message: "Job updated!",
    };
  }

  async deleteJob(jobId) {
    const { error } = await this.supabase
      .from("jobs")
      .delete()
      .eq("id", jobId);

    if (error) {
      return {
        ok: false,
        message: error.message || "Error deleting job",
        error,
      };
    }

    return {
      ok: true,
      redirectTo: "/jobs",
      message: "Job deleted",
    };
  }
}

Object.freeze(JobApplication);
