using TranslateDemo.Domain.Enums;
using TranslateDemo.Domain.ValueObjects;

namespace TranslateDemo.Domain.Entities;

public sealed class TranslationJob
{
    public string JobId { get; init; } = string.Empty;
    public string FileName { get; init; } = string.Empty;
    public string InputKey { get; init; } = string.Empty;
    public string? OutputKey { get; set; }
    public string SourceLanguage { get; set; } = "auto";
    public string TargetLanguage { get; set; } = "en";
    public OutputFormat OutputFormat { get; set; } = OutputFormat.Docx;
    public string? ContentType { get; init; }
    public string? FileExtension { get; init; }
    public TranslationStatus Status { get; set; } = TranslationStatus.Uploading;
    public string? ErrorMessage { get; set; }
    public string? VerificationStatus { get; set; }
    public string? VerificationDetails { get; set; }
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

