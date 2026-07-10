import { describe, expect, it, vi } from "vitest";

import { JobApplication } from "./JobApplication";

function createSupabaseMock({
  user = { id: "user-1" },
  loadData = null,
  loadError = null,
  insertError = null,
  updateError = null,
  deleteError = null,
} = {}) {
  const getUser = vi.fn(async () => ({
    data: {
      user,
    },
  }));

  const insert = vi.fn(async () => ({
    error: insertError,
  }));

  const updateEq = vi.fn(async () => ({
    error: updateError,
  }));
  const update = vi.fn(() => ({
    eq: updateEq,
  }));

  const deleteEq = vi.fn(async () => ({
    error: deleteError,
  }));
  const deleteFn = vi.fn(() => ({
    eq: deleteEq,
  }));

  const single = vi.fn(async () => ({
    data: loadData,
    error: loadError,
  }));
  const selectEq = vi.fn(() => ({
    single,
  }));
  const select = vi.fn(() => ({
    eq: selectEq,
  }));

  const from = vi.fn((table) => {
    expect(table).toBe("jobs");

    return {
      insert,
      select,
      update,
      delete: deleteFn,
    };
  });

  return {
    auth: {
      getUser,
    },
    from,
    mocks: {
      getUser,
      from,
      insert,
      select,
      selectEq,
      single,
      update,
      updateEq,
      deleteFn,
      deleteEq,
    },
  };
}

function createJobForm(application) {
  return {
    ...application.getInitialJobForm(),
    jobTitle: "Project Scheduler",
    companyName: "409 Industrial",
    category: "Industrial",
    city: "Orange",
    employmentType: "Full-Time",
    payRange: "$40-$50/hr",
    description: "Plan and coordinate project schedules.",
    requirements: "Five years of scheduling experience.",
    contactName: "Hiring Manager",
    contactPhone: "409-555-0000",
    contactEmail: "jobs@example.com",
    applyUrl: "https://example.com/apply",
    communityJobPosting: true,
  };
}

describe("JobApplication", () => {
  it("creates an initial job form", () => {
    const application = new JobApplication();

    expect(application.getInitialJobForm()).toEqual({
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
  });

  it("creates independent initial job forms", () => {
    const application = new JobApplication();

    const firstForm = application.getInitialJobForm();
    const secondForm = application.getInitialJobForm();

    firstForm.jobTitle = "Changed Title";
    firstForm.communityJobPosting = true;

    expect(secondForm).toEqual({
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
  });

  it("requires authentication before creating a job", async () => {
    const supabase = createSupabaseMock({
      user: null,
    });

    const application = new JobApplication({ supabase });

    const result = await application.createJob(
      application.getInitialJobForm(),
    );

    expect(supabase.mocks.insert).not.toHaveBeenCalled();

    expect(result).toEqual({
      ok: false,
      redirectTo: "/auth",
      message: "Please create a free account before posting a job.",
      requiresAuthentication: true,
    });
  });

  it("creates a job", async () => {
    const supabase = createSupabaseMock();
    const application = new JobApplication({ supabase });
    const form = createJobForm(application);

    const result = await application.createJob(form);

    expect(supabase.mocks.getUser).toHaveBeenCalledOnce();

    expect(supabase.mocks.insert).toHaveBeenCalledWith([
      {
        job_title: "Project Scheduler",
        company_name: "409 Industrial",
        category: "Industrial",
        city: "Orange",
        employment_type: "Full-Time",
        pay_range: "$40-$50/hr",
        description: "Plan and coordinate project schedules.",
        requirements: "Five years of scheduling experience.",
        contact_name: "Hiring Manager",
        contact_phone: "409-555-0000",
        contact_email: "jobs@example.com",
        apply_url: "https://example.com/apply",
        community_job_posting: true,
      },
    ]);

    expect(result).toEqual({
      ok: true,
      redirectTo: "/jobs",
      message: "Job posted!",
    });
  });

  it("normalizes job creation failures", async () => {
    const insertError = {
      message: "Insert failed",
    };

    const supabase = createSupabaseMock({
      insertError,
    });

    const application = new JobApplication({ supabase });

    const result = await application.createJob(
      application.getInitialJobForm(),
    );

    expect(result).toEqual({
      ok: false,
      message: "Insert failed",
      error: insertError,
    });
  });

  it("provides a fallback job creation error message", async () => {
    const insertError = {};

    const supabase = createSupabaseMock({
      insertError,
    });

    const application = new JobApplication({ supabase });

    const result = await application.createJob(
      application.getInitialJobForm(),
    );

    expect(result).toEqual({
      ok: false,
      message: "Error posting job",
      error: insertError,
    });
  });

  it("loads a job into a form", async () => {
    const supabase = createSupabaseMock({
      loadData: {
        job_title: "Project Scheduler",
        company_name: "409 Industrial",
        category: "Industrial",
        city: "Orange",
        employment_type: "Full-Time",
        pay_range: "$40-$50/hr",
        description: "Plan and coordinate project schedules.",
        requirements: "Five years of scheduling experience.",
        contact_name: "Hiring Manager",
        contact_phone: "409-555-0000",
        contact_email: "jobs@example.com",
        apply_url: "https://example.com/apply",
        community_job_posting: true,
      },
    });

    const application = new JobApplication({ supabase });

    const result = await application.loadJob("job-1");

    expect(supabase.mocks.selectEq).toHaveBeenCalledWith("id", "job-1");

    expect(result).toEqual({
      ok: true,
      form: {
        jobTitle: "Project Scheduler",
        companyName: "409 Industrial",
        category: "Industrial",
        city: "Orange",
        employmentType: "Full-Time",
        payRange: "$40-$50/hr",
        description: "Plan and coordinate project schedules.",
        requirements: "Five years of scheduling experience.",
        contactName: "Hiring Manager",
        contactPhone: "409-555-0000",
        contactEmail: "jobs@example.com",
        applyUrl: "https://example.com/apply",
        communityJobPosting: true,
      },
    });
  });

  it("normalizes missing jobs", async () => {
    const loadError = {
      message: "Not found",
    };

    const supabase = createSupabaseMock({
      loadData: null,
      loadError,
    });

    const application = new JobApplication({ supabase });

    const result = await application.loadJob("missing-job");

    expect(result).toEqual({
      ok: false,
      redirectTo: "/jobs",
      message: "Job not found",
      error: loadError,
    });
  });

  it("updates a job", async () => {
    const supabase = createSupabaseMock();
    const application = new JobApplication({ supabase });
    const form = createJobForm(application);

    const result = await application.updateJob({
      jobId: "job-1",
      form,
    });

    expect(supabase.mocks.update).toHaveBeenCalledWith({
      job_title: "Project Scheduler",
      company_name: "409 Industrial",
      category: "Industrial",
      city: "Orange",
      employment_type: "Full-Time",
      pay_range: "$40-$50/hr",
      description: "Plan and coordinate project schedules.",
      requirements: "Five years of scheduling experience.",
      contact_name: "Hiring Manager",
      contact_phone: "409-555-0000",
      contact_email: "jobs@example.com",
      apply_url: "https://example.com/apply",
      community_job_posting: true,
    });

    expect(supabase.mocks.updateEq).toHaveBeenCalledWith("id", "job-1");

    expect(result).toEqual({
      ok: true,
      redirectTo: "/jobs",
      message: "Job updated!",
    });
  });

  it("normalizes job update failures", async () => {
    const updateError = {
      message: "Update failed",
    };

    const supabase = createSupabaseMock({
      updateError,
    });

    const application = new JobApplication({ supabase });

    const result = await application.updateJob({
      jobId: "job-1",
      form: application.getInitialJobForm(),
    });

    expect(result).toEqual({
      ok: false,
      message: "Update failed",
      error: updateError,
    });
  });

  it("deletes a job", async () => {
    const supabase = createSupabaseMock();
    const application = new JobApplication({ supabase });

    const result = await application.deleteJob("job-1");

    expect(supabase.mocks.deleteEq).toHaveBeenCalledWith("id", "job-1");

    expect(result).toEqual({
      ok: true,
      redirectTo: "/jobs",
      message: "Job deleted",
    });
  });

  it("normalizes job deletion failures", async () => {
    const deleteError = {
      message: "Delete failed",
    };

    const supabase = createSupabaseMock({
      deleteError,
    });

    const application = new JobApplication({ supabase });

    const result = await application.deleteJob("job-1");

    expect(result).toEqual({
      ok: false,
      message: "Delete failed",
      error: deleteError,
    });
  });
});
