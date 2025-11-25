using TranslateDemo.Application.Contracts;
using TranslateDemo.Domain.Abstractions;

namespace TranslateDemo.Application.UseCases;

public sealed class GetStatusUseCase
{
    private readonly IJobRepository _jobs;
    private readonly IDownloadUrlSigner _signer;

    public GetStatusUseCase(IJobRepository jobs, IDownloadUrlSigner signer)
    {
        _jobs = jobs;
        _signer = signer;
    }

    public async Task<StatusResponse> HandleAsync(string jobId, CancellationToken ct = default)
    {
        var job = await _jobs.GetAsync(jobId, ct) ?? throw new KeyNotFoundException("Job not found");

        string? url = null;
        if (!string.IsNullOrEmpty(job.OutputKey))
        {
            url = await _signer.SignAsync(job.OutputKey!, TimeSpan.FromMinutes(10), ct);
        }

        return new StatusResponse(job, url);
    }
}

