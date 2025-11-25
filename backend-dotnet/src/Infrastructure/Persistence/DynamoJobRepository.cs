using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.DataModel;
using Amazon.DynamoDBv2.DocumentModel;
using TranslateDemo.Domain.Abstractions;
using TranslateDemo.Domain.Entities;
using TranslateDemo.Domain.Enums;
using TranslateDemo.Domain.ValueObjects;

namespace TranslateDemo.Infrastructure.Persistence;

[DynamoDBTable("TranslateJobs")]
public sealed class DynamoJobModel
{
    [DynamoDBHashKey("jobId")]
    public string JobId { get; set; } = string.Empty;

    public string FileName { get; set; } = string.Empty;
    public string InputKey { get; set; } = string.Empty;
    public string? OutputKey { get; set; }
    public string SourceLanguage { get; set; } = "auto";
    public string TargetLanguage { get; set; } = "en";
    public string OutputFormat { get; set; } = "docx";
    public string? ContentType { get; set; }
    public string? FileExtension { get; set; }
    public string Status { get; set; } = "UPLOADING";
    public string? ErrorMessage { get; set; }
    public string? VerificationStatus { get; set; }
    public string? VerificationDetails { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class DynamoJobRepository : IJobRepository
{
    private readonly DynamoDBContext _ctx;
    private readonly string _tableName;

    public DynamoJobRepository(IAmazonDynamoDB ddb, string tableName)
    {
        _ctx = new DynamoDBContext(ddb, new DynamoDBContextConfig { TableNamePrefix = string.Empty });
        _tableName = tableName;
    }

    public async Task SaveAsync(TranslationJob job, CancellationToken ct = default)
    {
        var model = ToModel(job);
        await _ctx.SaveAsync(model, new DynamoDBOperationConfig { OverrideTableName = _tableName }, ct);
    }

    public async Task<TranslationJob?> GetAsync(string jobId, CancellationToken ct = default)
    {
        var model = await _ctx.LoadAsync<DynamoJobModel>(jobId, new DynamoDBOperationConfig { OverrideTableName = _tableName }, ct);
        return model is null ? null : ToDomain(model);
    }

    public async Task UpdateStatusAsync(string jobId, TranslationStatus status, string? errorMessage, CancellationToken ct = default)
    {
        var job = await GetAsync(jobId, ct);
        if (job is null) return;
        job.Status = status;
        job.ErrorMessage = errorMessage;
        job.UpdatedAt = DateTime.UtcNow;
        await UpdateAsync(job, ct);
    }

    public async Task UpdateAsync(TranslationJob job, CancellationToken ct = default)
    {
        var model = ToModel(job);
        await _ctx.SaveAsync(model, new DynamoDBOperationConfig { OverrideTableName = _tableName }, ct);
    }

    private static DynamoJobModel ToModel(TranslationJob job) => new()
    {
        JobId = job.JobId,
        FileName = job.FileName,
        InputKey = job.InputKey,
        OutputKey = job.OutputKey,
        SourceLanguage = job.SourceLanguage,
        TargetLanguage = job.TargetLanguage,
        OutputFormat = job.OutputFormat.ToString().ToLowerInvariant(),
        ContentType = job.ContentType,
        FileExtension = job.FileExtension,
        Status = job.Status.ToString().ToUpperInvariant(),
        ErrorMessage = job.ErrorMessage,
        VerificationStatus = job.VerificationStatus,
        VerificationDetails = job.VerificationDetails,
        CreatedAt = job.CreatedAt,
        UpdatedAt = job.UpdatedAt
    };

    private static TranslationJob ToDomain(DynamoJobModel model) => new()
    {
        JobId = model.JobId,
        FileName = model.FileName,
        InputKey = model.InputKey,
        OutputKey = model.OutputKey,
        SourceLanguage = model.SourceLanguage,
        TargetLanguage = model.TargetLanguage,
        OutputFormat = Enum.TryParse<OutputFormat>(model.OutputFormat, true, out var format) ? format : OutputFormat.Docx,
        ContentType = model.ContentType,
        FileExtension = model.FileExtension,
        Status = Enum.TryParse<TranslationStatus>(model.Status, true, out var status) ? status : TranslationStatus.Uploading,
        ErrorMessage = model.ErrorMessage,
        VerificationStatus = model.VerificationStatus,
        VerificationDetails = model.VerificationDetails,
        CreatedAt = model.CreatedAt,
        UpdatedAt = model.UpdatedAt
    };
}

