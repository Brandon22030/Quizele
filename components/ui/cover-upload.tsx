"use client";

import * as React from "react";
import { Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { compressImage } from "@/lib/image-compress";
import { uploadCover } from "@/app/quiz/[id]/actions";

type CoverUploadProps = Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> & {
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

function CoverUpload({
  value,
  onChange,
  disabled,
  className,
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  ...props
}: CoverUploadProps) {
  const [isUploading, setIsUploading] = React.useState(false);
  const [dragActive, setDragActive] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { addToast } = useToast();

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      addToast({
        title: "Format non supporté",
        description: "Choisis une image (JPG, PNG, WEBP).",
        variant: "error",
      });
      return;
    }

    setIsUploading(true);
    try {
      const compressed = await compressImage(file, {
        maxWidth: 1024,
        maxHeight: 1024,
        quality: 0.75,
      });
      const uploadFile = new File([compressed], file.name, {
        type: "image/jpeg",
      });
      const formData = new FormData();
      formData.set("cover", uploadFile);

      const publicUrl = await uploadCover(formData);
      onChange(publicUrl);
      addToast({
        title: "Image enregistrée",
        variant: "success",
      });
    } catch (error) {
      addToast({
        title: "Erreur lors de l'envoi",
        description:
          error instanceof Error
            ? error.message
            : "L'image n'a pas pu être envoyée.",
        variant: "error",
      });
    } finally {
      setIsUploading(false);
    }
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
  }

  return (
    <div
      id={id}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
      className={cn("space-y-3", className)}
      {...props}
    >
      {value ? (
        <div className="relative aspect-video w-full overflow-hidden rounded-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Couverture du quiz"
            className="h-full w-full object-cover"
          />
          <Button
            type="button"
            variant="ghost"
            size="md"
            aria-label="Supprimer l'image de couverture"
            className="absolute right-2 top-2 bg-encre/80 text-craie hover:bg-encre focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onChange(null)}
            disabled={disabled || isUploading}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-input p-6 text-center transition-colors",
            dragActive
              ? "border-indigo bg-adire/10"
              : "hover:border-indigo hover:bg-adire/5",
            (disabled || isUploading) &&
              "pointer-events-none opacity-50"
          )}
        >
          <Upload className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-foreground">
            {isUploading
              ? "Envoi en cours…"
              : "Glisse une image ici ou clique pour choisir"}
          </p>
          <p className="text-xs text-muted-foreground">
            JPG, PNG, WEBP — max 2 Mo recommandé
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleChange}
            disabled={disabled || isUploading}
            aria-label="Image de couverture"
          />
        </div>
      )}
    </div>
  );
}

export { CoverUpload };
export type { CoverUploadProps };
