using System.Globalization;
using TranslateDemo.Application.Contracts;
using TranslateDemo.Domain.Abstractions;
using TranslateDemo.Domain.Entities;
using TranslateDemo.Domain.Enums;
using TranslateDemo.Domain.ValueObjects;

namespace TranslateDemo.Application.UseCases;

public sealed class CreateUploadUrlUseCase
{
    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        "txt", "md", "json", "docx", "pdf"
    };

    private static readonly Dictionary<string, string> ExtensionContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["txt"] = "text/plain",
        ["md"] = "text/markdown",
        ["json"] = "application/json",
        ["docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ["pdf"] = "application/pdf"
    };

    private readonly IJobRepository _jobs;
    private readonly IPresignedUploadService _presigned;
    private readonly long _maxSizeBytes;

    public CreateUploadUrlUseCase(IJobRepository jobs, IPresignedUploadService presigned, long maxSizeBytes = 5 * 1024 * 1024)
    {
        _jobs = jobs;
        _presigned = presigned;
        _maxSizeBytes = maxSizeBytes;
    }

    public async Task<CreateUploadResponse> HandleAsync(CreateUploadRequest request, CancellationToken ct = default)
    {
        var extension = request.FileName.Split('.').LastOrDefault()?.ToLowerInvariant();
        if (extension is null || !AllowedExtensions.Contains(extension))
        {
            throw new InvalidOperationException("Unsupported file type");
        }

        var contentType = request.ContentType ?? (ExtensionContentTypes.TryGetValue(extension, out var ctHint) ? ctHint : "application/octet-stream");
        var jobId = Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture);
        var key = $"raw/{jobId}/{request.FileName}";

        var upload = await _presigned.CreateAsync(key, contentType, _maxSizeBytes, ct);

        var now = DateTime.UtcNow;
        var job = new TranslationJob
        {
            JobId = jobId,
            FileName = request.FileName,
            SourceLanguage = request.SourceLanguage ?? "auto",
            TargetLanguage = request.TargetLanguage,
            OutputFormat = request.OutputFormat,
            Status = TranslationStatus.Uploading,
            InputKey = key,
            ContentType = contentType,
            FileExtension = extension,
            VerificationStatus = "PENDING",
            CreatedAt = now,
            UpdatedAt = now
        };

        await _jobs.SaveAsync(job, ct);

        return new CreateUploadResponse(jobId, upload.Url, upload.Fields);
    }
}

