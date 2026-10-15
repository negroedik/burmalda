# PgmzChat: let R8 optimize and obfuscate app bytecode.
# The launcher Activity name is retained automatically from AndroidManifest.xml.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
# Preserve JavaScript interface/reflection names if such bridges are added later.
# (No addJavascriptInterface bridge is currently used.)
