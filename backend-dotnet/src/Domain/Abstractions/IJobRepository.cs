using TranslateDemo.Domain.Entities;
using TranslateDemo.Domain.Enums;

namespace TranslateDemo.Domain.Abstractions;

public interface IJobRepository
{
    Task SaveAsync(TranslationJob job, CancellationToken ct = default);
    Task<TranslationJob?> GetAsync(string jobId, CancellationToken ct = default);
    Task UpdateStatusAsync(string jobId, TranslationStatus status, string? errorMessage, CancellationToken ct = default);
    Task UpdateAsync(TranslationJob job, CancellationToken ct = default);
}

